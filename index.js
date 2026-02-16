import express from "express"
import cors from "cors"
import { Pool } from "pg"

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

// 创建简历
app.post("/resumes", async (req, res) => {
  const { userId, title, content } = req.body || {}

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
      [userId || null, title || null, content]
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

// 列出最近 20 条简历
app.get("/resumes", async (_req, res) => {
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
      ORDER BY created_at DESC
      LIMIT 20
      `
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

// 获取单个简历
app.get("/resumes/:id", async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id)) {
    return res.status(400).json({ ok: false, error: "invalid id" })
  }

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
      WHERE id = $1
      `,
      [id]
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

// 更新简历
app.put("/resumes/:id", async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id)) {
    return res.status(400).json({ ok: false, error: "invalid id" })
  }

  const { title, content } = req.body || {}
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
      WHERE id = $3
      RETURNING id, user_id AS "userId", title, content, created_at AS "createdAt"
      `,
      [title || null, content, id]
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

// 删除简历
app.delete("/resumes/:id", async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id)) {
    return res.status(400).json({ ok: false, error: "invalid id" })
  }

  try {
    await ensureResumesTable()

    const result = await pool.query(
      `
      DELETE FROM resumes
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