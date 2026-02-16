import express from "express"
import cors from "cors"
import { Pool } from "pg"
import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"

const app = express()
const port = process.env.PORT || 3000

app.use(cors())
app.use(express.json())

const pool = new Pool({
  host: process.env.PGHOST || "82.29.197.201",
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD || "Resume123!",
  database: process.env.PGDATABASE || "postgres",
})

const JWT_SECRET = process.env.JWT_SECRET || "EvalShare-JWT-Secret-Change-This"

function createToken(user) {
  return jwt.sign(
    { userId: user.id, email: user.email },
    JWT_SECRET,
    { expiresIn: "30d" }
  )
}

function auth(req, res, next) {
  const header = req.headers.authorization || ""
  if (!header.startsWith("Bearer ")) {
    return res.status(401).json({ ok: false, error: "unauthorized" })
  }
  const token = header.slice(7)
  try {
    const payload = jwt.verify(token, JWT_SECRET)
    req.user = { id: payload.userId, email: payload.email }
    next()
  } catch (err) {
    console.error("auth error:", err)
    return res.status(401).json({ ok: false, error: "invalid token" })
  }
}

async function ensureUsersTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `)
}

async function ensureResumesTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS resumes (
      id SERIAL PRIMARY KEY,
      user_id TEXT,
      title TEXT,
      content TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `)
}

app.get("/health", (req, res) => {
  res.json({ status: "ok" })
})

app.get("/db-test", async (req, res) => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS test_events (
        id SERIAL PRIMARY KEY,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `)

    await pool.query("INSERT INTO test_events DEFAULT VALUES")

    const result = await pool.query(
      "SELECT COUNT(*)::int AS count FROM test_events"
    )

    res.json({
      ok: true,
      count: result.rows[0]?.count ?? 0,
    })
  } catch (error) {
    console.error("db-test error:", error)
    res.status(500).json({
      ok: false,
      error: error.message,
    })
  }
})

app.post("/auth/register", async (req, res) => {
  const { email, password, fullName } = req.body || {}
  const trimmedEmail = typeof email === "string" ? email.trim().toLowerCase() : ""
  const plainPassword = typeof password === "string" ? password : ""
  const name = typeof fullName === "string" ? fullName.trim() : ""

  if (!trimmedEmail || !plainPassword) {
    return res
      .status(400)
      .json({ ok: false, error: "email and password are required" })
  }

  try {
    await ensureUsersTable()
    const existing = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [trimmedEmail]
    )
    if (existing.rows.length > 0) {
      return res.status(409).json({ ok: false, error: "email already registered" })
    }

    const passwordHash = await bcrypt.hash(plainPassword, 10)

    const result = await pool.query(
      `
      INSERT INTO users (email, password_hash, full_name)
      VALUES ($1, $2, $3)
      RETURNING id, email, full_name
      `,
      [trimmedEmail, passwordHash, name || null]
    )

    const user = {
      id: result.rows[0].id,
      email: result.rows[0].email,
      fullName: result.rows[0].full_name,
    }
    const token = createToken(user)

    res.status(201).json({
      ok: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
      },
    })
  } catch (error) {
    console.error("register error:", error)
    res.status(500).json({
      ok: false,
      error: error.message,
    })
  }
})

app.post("/auth/login", async (req, res) => {
  const { email, password } = req.body || {}
  const trimmedEmail = typeof email === "string" ? email.trim().toLowerCase() : ""
  const plainPassword = typeof password === "string" ? password : ""

  if (!trimmedEmail || !plainPassword) {
    return res
      .status(400)
      .json({ ok: false, error: "email and password are required" })
  }

  try {
    await ensureUsersTable()
    const result = await pool.query(
      `
      SELECT id, email, password_hash, full_name
      FROM users
      WHERE email = $1
      `,
      [trimmedEmail]
    )

    if (!result.rows.length) {
      return res.status(401).json({ ok: false, error: "invalid email or password" })
    }

    const row = result.rows[0]
    const ok = await bcrypt.compare(plainPassword, row.password_hash)
    if (!ok) {
      return res.status(401).json({ ok: false, error: "invalid email or password" })
    }

    const user = {
      id: row.id,
      email: row.email,
      fullName: row.full_name,
    }
    const token = createToken(user)

    res.json({
      ok: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
      },
    })
  } catch (error) {
    console.error("login error:", error)
    res.status(500).json({
      ok: false,
      error: error.message,
    })
  }
})

app.get("/me", auth, (req, res) => {
  res.json({
    ok: true,
    user: {
      id: req.user.id,
      email: req.user.email,
    },
  })
})

app.post("/resumes", auth, async (req, res) => {
  const { title, content } = req.body || {}
  const authUserId = String(req.user.id)

  if (!content) {
    return res.status(400).json({
      ok: false,
      error: "content is required",
    })
  }

  try {
    await ensureResumesTable()

    const result = await pool.query(
      `
      INSERT INTO resumes (user_id, title, content)
      VALUES ($1, $2, $3)
      RETURNING id, user_id AS "userId", title, content, created_at AS "createdAt"
      `,
      [authUserId, title || null, content]
    )

    res.status(201).json({
      ok: true,
      resume: result.rows[0],
    })
  } catch (error) {
    console.error("create resume error:", error)
    res.status(500).json({
      ok: false,
      error: error.message,
    })
  }
})

app.get("/resumes", auth, async (req, res) => {
  const authUserId = String(req.user.id)
  try {
    await ensureResumesTable()

    const result = await pool.query(
      `
      SELECT
        id,
        user_id AS "userId",
        title,
        content,
        created_at AS "createdAt"
      FROM resumes
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 20
      `,
      [authUserId]
    )

    res.json({
      ok: true,
      resumes: result.rows,
    })
  } catch (error) {
    console.error("list resumes error:", error)
    res.status(500).json({
      ok: false,
      error: error.message,
    })
  }
})

app.get("/resumes/:id", auth, async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id)) {
    return res.status(400).json({ ok: false, error: "invalid id" })
  }

  const authUserId = String(req.user.id)

  try {
    await ensureResumesTable()

    const result = await pool.query(
      `
      SELECT
        id,
        user_id AS "userId",
        title,
        content,
        created_at AS "createdAt"
      FROM resumes
      WHERE id = $1 AND user_id = $2
      `,
      [id, authUserId]
    )

    if (!result.rows.length) {
      return res.status(404).json({ ok: false, error: "not found" })
    }

    res.json({
      ok: true,
      resume: result.rows[0],
    })
  } catch (error) {
    console.error("get resume error:", error)
    res.status(500).json({
      ok: false,
      error: error.message,
    })
  }
})

app.put("/resumes/:id", auth, async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id)) {
    return res.status(400).json({ ok: false, error: "invalid id" })
  }

  const { title, content } = req.body || {}
  const authUserId = String(req.user.id)

  if (!content) {
    return res.status(400).json({
      ok: false,
      error: "content is required",
    })
  }

  try {
    await ensureResumesTable()

    const result = await pool.query(
      `
      UPDATE resumes
      SET title = $1,
          content = $2
      WHERE id = $3 AND user_id = $4
      RETURNING id, user_id AS "userId", title, content, created_at AS "createdAt"
      `,
      [title || null, content, id, authUserId]
    )

    if (!result.rows.length) {
      return res.status(404).json({ ok: false, error: "not found" })
    }

    res.json({
      ok: true,
      resume: result.rows[0],
    })
  } catch (error) {
    console.error("update resume error:", error)
    res.status(500).json({
      ok: false,
      error: error.message,
    })
  }
})

app.delete("/resumes/:id", auth, async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id)) {
    return res.status(400).json({ ok: false, error: "invalid id" })
  }

  const authUserId = String(req.user.id)

  try {
    await ensureResumesTable()

    const result = await pool.query(
      `
      DELETE FROM resumes
      WHERE id = $1 AND user_id = $2
      RETURNING id
      `,
      [id, authUserId]
    )

    if (!result.rows.length) {
      return res.status(404).json({ ok: false, error: "not found" })
    }

    res.json({ ok: true })
  } catch (error) {
    console.error("delete resume error:", error)
    res.status(500).json({
      ok: false,
      error: error.message,
    })
  }
})

app.listen(port, () => {
  console.log(`API server listening on port ${port}`)
})