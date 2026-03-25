const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const bcrypt = require('bcrypt');

async function setup() {
    const db = await open({
        filename: './database.sqlite',
        driver: sqlite3.Database
    });

    await db.exec(`
        DROP TABLE IF EXISTS Jobs;
        DROP TABLE IF EXISTS Users;
        CREATE TABLE IF NOT EXISTS Users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT DEFAULT 'member'
        );

        CREATE TABLE IF NOT EXISTS Jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT,
            status TEXT DEFAULT 'active',
            proof_image_url TEXT,
            assigned_to_user_id INTEGER,
            FOREIGN KEY(assigned_to_user_id) REFERENCES Users(id)
        );
    `);

    // Insert dummy leader and member
    const leaderPasswordHash = await bcrypt.hash('password123', 10);
    const memberPasswordHash = await bcrypt.hash('password123', 10);

    const leader = await db.get("SELECT * FROM Users WHERE username = 'leader'");
    if (!leader) {
        await db.run(
            "INSERT INTO Users (username, password_hash, role) VALUES (?, ?, ?)", 
            ['leader', leaderPasswordHash, 'leader']
        );
        console.log("Inserted dummy leader user.");
    }

    const member = await db.get("SELECT * FROM Users WHERE username = 'member'");
    if (!member) {
        await db.run(
            "INSERT INTO Users (username, password_hash, role) VALUES (?, ?, ?)", 
            ['member', memberPasswordHash, 'member']
        );
        console.log("Inserted dummy member user.");
    }

    console.log("Database initialized successfully!");
    await db.close();
}

setup().catch(console.error);
