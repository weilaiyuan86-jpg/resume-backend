import express from "express"
import cors from "cors"
import { Pool } from "pg"
import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"
import crypto from "crypto"

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
      role TEXT,
      plan TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `)
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT`)
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT`)
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
  const isSuperAdmin = trimmedEmail === "zhangyang_0105@qq.com"
  const role = isSuperAdmin ? "super_admin" : "user"
  const plan = "free"

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
      INSERT INTO users (email, password_hash, full_name, role, plan)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, email, full_name, role, plan, created_at
      `,
      [trimmedEmail, passwordHash, name || null, role, plan]
    )

    const user = {
      id: result.rows[0].id,
      email: result.rows[0].email,
      fullName: result.rows[0].full_name,
      role: result.rows[0].role,
      plan: result.rows[0].plan,
      createdAt: result.rows[0].created_at,
    }
    const token = createToken(user)

    res.status(201).json({
      ok: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        plan: user.plan,
        createdAt: user.createdAt,
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
      SELECT id, email, password_hash, full_name, role, plan, created_at
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
      role: row.role,
      plan: row.plan,
      createdAt: row.created_at,
    }
    const token = createToken(user)

    res.json({
      ok: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        plan: user.plan,
        createdAt: user.createdAt,
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

async function getUserById(id) {
  await ensureUsersTable()
  const result = await pool.query(
    `
    SELECT id, email, full_name, role, plan, created_at
    FROM users
    WHERE id = $1
    `,
    [id]
  )
  if (!result.rows.length) return null
  const row = result.rows[0]
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    plan: row.plan,
    createdAt: row.created_at,
  }
}

async function requireAdmin(req, res, next) {
  try {
    const current = await getUserById(req.user.id)
    if (!current) {
      return res.status(401).json({ ok: false, error: "user not found" })
    }
    const email = String(current.email || "").toLowerCase()
    const role = current.role
    const isAdmin =
      role === "super_admin" ||
      role === "admin" ||
      email === "zhangyang_0105@qq.com"
    if (!isAdmin) {
      return res.status(403).json({ ok: false, error: "forbidden" })
    }
    next()
  } catch (error) {
    console.error("requireAdmin error:", error)
    res.status(500).json({ ok: false, error: error.message })
  }
}

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

app.get("/admin/users", auth, requireAdmin, async (req, res) => {
  try {
    await ensureUsersTable()
    const result = await pool.query(
      `
      SELECT id, email, full_name, role, plan, created_at
      FROM users
      ORDER BY created_at DESC, id DESC
      `
    )
    res.json({
      ok: true,
      users: result.rows.map((row) => ({
        id: row.id,
        email: row.email,
        fullName: row.full_name,
        role: row.role,
        plan: row.plan,
        createdAt: row.created_at,
      })),
    })
  } catch (error) {
    console.error("list users error:", error)
    res.status(500).json({ ok: false, error: error.message })
  }
})

app.post("/admin/users", auth, requireAdmin, async (req, res) => {
  const { email, fullName, plan, password } = req.body || {}
  const trimmedEmail = typeof email === "string" ? email.trim().toLowerCase() : ""
  const name = typeof fullName === "string" ? fullName.trim() : ""
  const rawPlan = typeof plan === "string" ? plan.trim() : ""
  const plainPassword = typeof password === "string" ? password : ""

  if (!trimmedEmail) {
    return res.status(400).json({ ok: false, error: "email is required" })
  }

  const isSuperAdmin = trimmedEmail === "zhangyang_0105@qq.com"
  const role = isSuperAdmin ? "super_admin" : "user"
  const finalPlan = rawPlan || "free"

  try {
    await ensureUsersTable()
    const existing = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [trimmedEmail]
    )
    if (existing.rows.length > 0) {
      return res.status(409).json({ ok: false, error: "email already exists" })
    }

    const initialPassword =
      plainPassword || crypto.randomBytes(12).toString("base64url")
    const passwordHash = await bcrypt.hash(initialPassword, 10)

    const result = await pool.query(
      `
      INSERT INTO users (email, password_hash, full_name, role, plan)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, email, full_name, role, plan, created_at
      `,
      [trimmedEmail, passwordHash, name || null, role, finalPlan]
    )

    const row = result.rows[0]

    res.status(201).json({
      ok: true,
      user: {
        id: row.id,
        email: row.email,
        fullName: row.full_name,
        role: row.role,
        plan: row.plan,
        createdAt: row.created_at,
      },
      initialPassword: plainPassword ? undefined : initialPassword,
    })
  } catch (error) {
    console.error("create user error:", error)
    res.status(500).json({ ok: false, error: error.message })
  }
})

app.patch("/admin/users/:id", auth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id)) {
    return res.status(400).json({ ok: false, error: "invalid id" })
  }

  const { email, fullName, plan, role, password } = req.body || {}
  const trimmedEmail =
    typeof email === "string" ? email.trim().toLowerCase() : undefined
  const name = typeof fullName === "string" ? fullName.trim() : undefined
  const rawPlan = typeof plan === "string" ? plan.trim() : undefined
  const rawRole = typeof role === "string" ? role.trim() : undefined
  const plainPassword = typeof password === "string" ? password : ""

  const fields = []
  const values = []
  let index = 1

  if (trimmedEmail) {
    fields.push(`email = $${index++}`)
    values.push(trimmedEmail)
  }
  if (typeof name === "string") {
    fields.push(`full_name = $${index++}`)
    values.push(name || null)
  }
  if (typeof rawPlan === "string") {
    fields.push(`plan = $${index++}`)
    values.push(rawPlan || null)
  }
  if (typeof rawRole === "string") {
    const allowedRoles = ["super_admin", "admin", "viewer", "user"]
    if (!allowedRoles.includes(rawRole)) {
      return res.status(400).json({ ok: false, error: "invalid role" })
    }
    fields.push(`role = $${index++}`)
    values.push(rawRole)
  }

  if (plainPassword) {
    const passwordHash = await bcrypt.hash(plainPassword, 10)
    fields.push(`password_hash = $${index++}`)
    values.push(passwordHash)
  }

  if (!fields.length) {
    return res.status(400).json({ ok: false, error: "no fields to update" })
  }

  values.push(id)

  try {
    await ensureUsersTable()
    const result = await pool.query(
      `
      UPDATE users
      SET ${fields.join(", ")}
      WHERE id = $${index}
      RETURNING id, email, full_name, role, plan, created_at
      `,
      values
    )

    if (!result.rows.length) {
      return res.status(404).json({ ok: false, error: "not found" })
    }

    const row = result.rows[0]

    res.json({
      ok: true,
      user: {
        id: row.id,
        email: row.email,
        fullName: row.full_name,
        role: row.role,
        plan: row.plan,
        createdAt: row.created_at,
      },
    })
  } catch (error) {
    console.error("update user error:", error)
    res.status(500).json({ ok: false, error: error.message })
  }
})

app.delete("/admin/users/:id", auth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id)) {
    return res.status(400).json({ ok: false, error: "invalid id" })
  }

  try {
    await ensureUsersTable()
    const result = await pool.query(
      `
      DELETE FROM users
      WHERE id = $1
      RETURNING id
      `,
      [id]
    )

    if (!result.rows.length) {
      return res.status(404).json({ ok: false, error: "not found" })
    }

    res.json({ ok: true })
  } catch (error) {
    console.error("delete user error:", error)
    res.status(500).json({ ok: false, error: error.message })
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
