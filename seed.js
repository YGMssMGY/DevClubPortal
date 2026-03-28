const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const bcrypt = require("bcrypt");
const path = require("path");

async function seed() {
	const dbPath = path.join(__dirname, "database.sqlite");
	const db = await open({
		filename: dbPath,
		driver: sqlite3.Database,
	});

	await db.exec("PRAGMA foreign_keys = ON;");

	await db.exec(`
        DROP TABLE IF EXISTS Team_Events;
        DROP TABLE IF EXISTS Team_Members;
        DROP TABLE IF EXISTS Jobs;
        DROP TABLE IF EXISTS Teams;
        DROP TABLE IF EXISTS Users;

        CREATE TABLE Users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT DEFAULT 'member'
        );

        CREATE TABLE Teams (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            created_by INTEGER,
            FOREIGN KEY(created_by) REFERENCES Users(id) ON DELETE CASCADE
        );

        CREATE TABLE Team_Members (
            team_id INTEGER,
            user_id INTEGER,
            role_in_team TEXT,
            PRIMARY KEY (team_id, user_id),
            FOREIGN KEY(team_id) REFERENCES Teams(id) ON DELETE CASCADE,
            FOREIGN KEY(user_id) REFERENCES Users(id) ON DELETE CASCADE
        );

        CREATE TABLE Team_Events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            team_id INTEGER,
            title TEXT NOT NULL,
            start_date TEXT,
            end_date TEXT,
            FOREIGN KEY(team_id) REFERENCES Teams(id) ON DELETE CASCADE
        );

        CREATE TABLE Jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT,
            status TEXT DEFAULT 'active',
            proof_image_url TEXT,
            assigned_to_user_id INTEGER,
            team_id INTEGER,
            created_by INTEGER,
            FOREIGN KEY(assigned_to_user_id) REFERENCES Users(id) ON DELETE CASCADE,
            FOREIGN KEY(team_id) REFERENCES Teams(id) ON DELETE CASCADE,
            FOREIGN KEY(created_by) REFERENCES Users(id) ON DELETE CASCADE
        );
    `);

	const chiefPasswordHash = await bcrypt.hash("testpassword", 10);
	await db.run("INSERT INTO Users (username, password_hash, role) VALUES (?, ?, ?)", [
		"admin",
		chiefPasswordHash,
		"chief_lead",
	]);

	console.log(
		"Database seeded successfully with 'admin' chief_lead and all CASCADE constraints enabled.",
	);
	await db.close();
}

seed().catch(console.error);
