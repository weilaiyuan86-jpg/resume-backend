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

app.get("/resumes", async (req, res) => {
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

app.listen(port, () => {
  console.log(`API server listening on port ${port}`)
})