import express from "express"
import cors from "cors"
import { Pool } from "pg"

const app = express()
const port = process.env.PORT || 3000

app.use(cors())
app.use(express.json())

// 数据库连接池配置
const pool = new Pool({
  host: process.env.PGHOST || "82.29.197.201",
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD || "Resume123!",
  database: process.env.PGDATABASE || "postgres",
})

// 健康检查
app.get("/health", (req, res) => {
  res.json({ status: "ok" })
})

// 数据库测试接口：建表 + 插入一行 + 返回总数
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

app.listen(port, () => {
  console.log(`API server listening on port ${port}`)
})