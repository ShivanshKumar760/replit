import express from "express";
import dotenv from "dotenv";
import { connectMongo } from "./config/mongo";
import { pool } from "./config/pg";
import router from "./routes/replit";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/", router);

const startServer = async (): Promise<void> => {
  try {
    await connectMongo();
    await pool.connect();
    //check table exist or not
    const tableCheck = await pool.query(
      `
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'users'
      );
      `
    );

    const exists = tableCheck.rows[0].exists;
    if (!exists) {
      console.log("⚠️ Users table not found. Creating...");

      await pool.query(`
        CREATE TABLE users (
          id UUID PRIMARY KEY,
          email TEXT UNIQUE NOT NULL,
          password TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT NOW()
        );
      `);

      console.log("✅ Users table created");
    } else {
      console.log("✅ Users table already exists");
    }
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Error starting server:", error);
    process.exit(1);
  }
};

startServer();
