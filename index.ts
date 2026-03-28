/**
 * Club Portal API – Main Server
 *
 * Provides endpoints for user authentication, job management,
 * team coordination, and administrative controls.
 * Built with Express, SQLite, and TypeScript.
 */

import express, { Request, Response, NextFunction } from "express";
import sqlite3 from "sqlite3";
import { open, Database } from "sqlite";
import bcrypt from "bcrypt";
import cookieParser from "cookie-parser";
import multer from "multer";
import path from "path";
import fs from "fs";

// -------------------------------------------------------------------
// Types & Interfaces
// -------------------------------------------------------------------

/**
 * Represents a user in the system.
 */
interface User {
	id: number;
	username: string;
	password_hash: string;
	role: "member" | "leader" | "chief_lead";
}

/**
 * Represents a job (individual or team objective).
 */
interface Job {
	id: number;
	title: string;
	description: string;
	status: "active" | "submitted" | "archived";
	proof_image_url: string | null;
	assigned_to_user_id: number | null;
	team_id: number | null;
	created_by: number;
}

/**
 * Represents a team (group of users).
 */
interface Team {
	id: number;
	name: string;
	created_by: number;
}

/**
 * Represents a member of a team, including their role inside the team.
 */
interface TeamMember {
	team_id: number;
	user_id: number;
	role_in_team: "member" | "leader";
}

/**
 * Extended team type that includes members, jobs, and events (used in chief‑lead responses).
 */
interface TeamWithMembers extends Team {
	members?: TeamMemberWithUser[];
	jobs?: Job[];
	events?: TeamEvent[];
}

/**
 * Extended team type used in the "my teams" response (includes role_in_team).
 */
interface MyTeam extends Team {
	role_in_team: string;
	members?: TeamMemberWithUser[];
	jobs?: Job[];
	events?: TeamEvent[];
}

/**
 * A team member joined with the user's basic information.
 */
type TeamMemberWithUser = TeamMember & Pick<User, "id" | "username" | "role">;

/**
 * Represents an event organised by a team.
 */
interface TeamEvent {
	id: number;
	team_id: number;
	title: string;
	start_date: string;
	end_date: string;
}

/**
 * Extend Express Request to include custom properties injected by middleware.
 */
declare global {
	namespace Express {
		interface Request {
			userId?: number;
			userRole?: User["role"];
		}
	}
}

// -------------------------------------------------------------------
// Setup
// -------------------------------------------------------------------

/**
 * Use the current working directory as the root for all file paths.
 * This ensures the code works regardless of where the compiled output resides.
 */
const projectRoot = process.cwd();
const uploadsDir = path.join(projectRoot, "public", "uploads");

if (!fs.existsSync(uploadsDir)) {
	fs.mkdirSync(uploadsDir, { recursive: true });
}

/**
 * Configure multer storage for uploaded proof images.
 */
const storage = multer.diskStorage({
	destination: (_req, _file, cb) => cb(null, uploadsDir),
	filename: (_req, file, cb) => {
		const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
		cb(null, uniqueSuffix + path.extname(file.originalname));
	},
});
const upload = multer({ storage });

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cookieParser());
app.use(express.static("public"));

/**
 * Database connection (SQLite with foreign key enforcement).
 */
let db: Database;

(async () => {
	db = await open({
		filename: path.join(projectRoot, "database.sqlite"),
		driver: sqlite3.Database,
	});
	await db.exec("PRAGMA foreign_keys = ON;");
	console.log("Connected to the SQLite database (foreign keys enabled).");
})();

// -------------------------------------------------------------------
// Middleware
// -------------------------------------------------------------------

/**
 * Ensures the user is authenticated (has a valid cookie).
 */
const requireAuth = (req: Request, res: Response, next: NextFunction) => {
	const userId = req.cookies.userId;
	if (!userId) {
		return res.status(401).json({ error: "Unauthorized: Please log in" });
	}
	req.userId = userId;
	req.userRole = req.cookies.userRole;
	next();
};

/**
 * Ensures the user has a leader role (leader or chief_lead).
 */
const requireLeader = (req: Request, res: Response, next: NextFunction) => {
	if (req.userRole !== "leader" && req.userRole !== "chief_lead") {
		return res.status(403).json({ error: "Forbidden: Requires leader role" });
	}
	next();
};

/**
 * Ensures the user is a chief_lead.
 */
const requireChiefLead = (req: Request, res: Response, next: NextFunction) => {
	if (req.userRole !== "chief_lead") {
		return res.status(403).json({ error: "Forbidden: Requires chief lead role" });
	}
	next();
};

// -------------------------------------------------------------------
// Routes
// -------------------------------------------------------------------

/**
 * Root endpoint – simple health check.
 */
app.get("/", (_req: Request, res: Response) => {
	res.send("Club Portal API is running!");
});

// -------------------- Auth --------------------

/**
 * Authenticate a user and set authentication cookies.
 */
app.post("/api/login", async (req: Request, res: Response) => {
	const { username, password } = req.body;
	if (!username || !password) {
		return res.status(400).json({ error: "Username and password are required" });
	}
	try {
		const user = await db.get<User>("SELECT * FROM Users WHERE username = ?", [username]);
		if (!user) return res.status(401).json({ error: "Invalid credentials" });

		const match = await bcrypt.compare(password, user.password_hash);
		if (!match) return res.status(401).json({ error: "Invalid credentials" });

		res.cookie("userId", user.id, {
			httpOnly: true,
			secure: process.env.NODE_ENV === "production",
		});
		res.cookie("userRole", user.role, {
			httpOnly: true,
			secure: process.env.NODE_ENV === "production",
		});
		res.json({ message: "Login successful", role: user.role });
	} catch (error) {
		console.error("Login error:", error);
		res.status(500).json({ error: "Internal server error" });
	}
});

// -------------------- Workspace: GET own jobs --------------------

/**
 * Retrieve all jobs assigned to the authenticated user,
 * either individually or through team membership.
 */
app.get("/api/jobs", requireAuth, async (req: Request, res: Response) => {
	try {
		const jobs = await db.all<Job[]>(
			`SELECT * FROM Jobs 
             WHERE assigned_to_user_id = ? 
             OR team_id IN (SELECT team_id FROM Team_Members WHERE user_id = ?)`,
			[req.userId, req.userId],
		);
		res.json({ jobs });
	} catch (error) {
		console.error("Error fetching jobs:", error);
		res.status(500).json({ error: "Internal server error" });
	}
});

// -------------------- Leader/Chief: view all users + jobs --------------------

/**
 * Provide a full overview of all users and their individual jobs.
 * Accessible only to leaders and chief leads.
 */
app.get("/api/admin/users", requireAuth, requireLeader, async (_req: Request, res: Response) => {
	try {
		const users = await db.all<User[]>("SELECT id, username, role FROM Users");
		const jobs = await db.all<Job[]>("SELECT * FROM Jobs");

		const usersWithJobs = users.map((user) => ({
			...user,
			jobs: jobs.filter((job) => job.assigned_to_user_id === user.id),
		}));

		res.json({ users: usersWithJobs });
	} catch (error) {
		console.error("Error fetching all users and jobs:", error);
		res.status(500).json({ error: "Internal server error" });
	}
});

// -------------------- Assign individual objective --------------------

/**
 * Create a new individual job and assign it to a user.
 * Permission rules:
 * - Chief leads can assign to leaders and members (not other chief leads).
 * - Leaders can assign only to members.
 */
app.post("/api/admin/jobs", requireAuth, requireLeader, async (req: Request, res: Response) => {
	const { title, description, assigned_to_user_id } = req.body;
	if (!title || !assigned_to_user_id) {
		return res.status(400).json({ error: "Title and assigned_to_user_id are required" });
	}

	try {
		const targetUser = await db.get<User>("SELECT id, role FROM Users WHERE id = ?", [
			assigned_to_user_id,
		]);
		if (!targetUser) {
			return res.status(404).json({ error: "Assigned user not found" });
		}

		// Chief leads can assign to leaders + members, but NOT chief_leads
		if (req.userRole === "chief_lead") {
			if (targetUser.role === "chief_lead") {
				return res
					.status(403)
					.json({ error: "Cannot assign objectives to other Chief Leads." });
			}
		}
		// Leaders can only assign to members
		if (req.userRole === "leader") {
			if (targetUser.role !== "member") {
				return res
					.status(403)
					.json({ error: "Leaders can only assign objectives to members." });
			}
		}

		const result = await db.run(
			"INSERT INTO Jobs (title, description, assigned_to_user_id, created_by) VALUES (?, ?, ?, ?)",
			[title, description, assigned_to_user_id, req.userId],
		);
		res.status(201).json({ message: "Job created successfully", jobId: result.lastID });
	} catch (error) {
		console.error("Error creating job:", error);
		res.status(500).json({ error: "Internal server error" });
	}
});

// -------------------- Submit proof --------------------

/**
 * Submit proof (image) for a job that belongs to the user
 * (either individually or via team membership).
 */
app.post(
	"/api/jobs/:id/submit",
	requireAuth,
	upload.single("proofImage"),
	async (req: Request, res: Response) => {
		const jobId = req.params.id;
		try {
			const job = await db.get<Job>(
				`SELECT * FROM Jobs 
             WHERE id = ? AND (
                 assigned_to_user_id = ? OR 
                 team_id IN (SELECT team_id FROM Team_Members WHERE user_id = ?)
             )`,
				[jobId, req.userId, req.userId],
			);
			if (!job)
				return res.status(404).json({ error: "Job not found or not assigned to you" });
			if (!req.file) return res.status(400).json({ error: "Proof image is required" });

			const proofUrl = "/uploads/" + req.file.filename;
			await db.run("UPDATE Jobs SET status = 'submitted', proof_image_url = ? WHERE id = ?", [
				proofUrl,
				jobId,
			]);
			res.json({ message: "Job submitted successfully", proofUrl });
		} catch (error) {
			console.error("Error submitting job:", error);
			res.status(500).json({ error: "Internal server error" });
		}
	},
);

// -------------------- Accept (archive) objective --------------------

/**
 * Accept a submitted job, moving it to archived status.
 * Permission rules:
 * - Chief leads can accept any job.
 * - The job's creator can accept it.
 * - Leaders can accept team jobs for teams they lead.
 */
app.post("/api/admin/jobs/:id/accept", requireAuth, async (req: Request, res: Response) => {
	const jobId = req.params.id;
	try {
		const job = await db.get<Job>("SELECT * FROM Jobs WHERE id = ?", [jobId]);
		if (!job) return res.status(404).json({ error: "Job not found" });

		// Chief leads can review everything
		if (req.userRole === "chief_lead") {
			await db.run("UPDATE Jobs SET status = 'archived' WHERE id = ?", [jobId]);
			return res.json({ message: "Objective accepted and archived" });
		}

		// The creator of the objective can review it
		if (String(job.created_by) === String(req.userId)) {
			await db.run("UPDATE Jobs SET status = 'archived' WHERE id = ?", [jobId]);
			return res.json({ message: "Objective accepted and archived" });
		}

		// Leaders can review team objectives for teams they lead
		if (req.userRole === "leader" && job.team_id) {
			const membership = await db.get(
				"SELECT * FROM Team_Members WHERE team_id = ? AND user_id = ? AND role_in_team = 'leader'",
				[job.team_id, req.userId],
			);
			if (membership) {
				await db.run("UPDATE Jobs SET status = 'archived' WHERE id = ?", [jobId]);
				return res.json({ message: "Objective accepted and archived" });
			}
		}

		return res
			.status(403)
			.json({ error: "You do not have permission to review this objective." });
	} catch (error) {
		console.error("Error accepting job:", error);
		res.status(500).json({ error: "Internal server error" });
	}
});

// -------------------- Reject objective --------------------

/**
 * Reject a submitted job, moving it back to active (with proof cleared).
 * Same permission rules as accept.
 */
app.post("/api/admin/jobs/:id/reject", requireAuth, async (req: Request, res: Response) => {
	const jobId = req.params.id;
	try {
		const job = await db.get<Job>("SELECT * FROM Jobs WHERE id = ?", [jobId]);
		if (!job) return res.status(404).json({ error: "Job not found" });

		// Chief leads can review everything
		if (req.userRole === "chief_lead") {
			await db.run("UPDATE Jobs SET status = 'active', proof_image_url = NULL WHERE id = ?", [
				jobId,
			]);
			return res.json({ message: "Objective rejected and pushed back to active" });
		}

		// The creator of the objective can review it
		if (String(job.created_by) === String(req.userId)) {
			await db.run("UPDATE Jobs SET status = 'active', proof_image_url = NULL WHERE id = ?", [
				jobId,
			]);
			return res.json({ message: "Objective rejected and pushed back to active" });
		}

		// Leaders can review team objectives for teams they lead
		if (req.userRole === "leader" && job.team_id) {
			const membership = await db.get(
				"SELECT * FROM Team_Members WHERE team_id = ? AND user_id = ? AND role_in_team = 'leader'",
				[job.team_id, req.userId],
			);
			if (membership) {
				await db.run(
					"UPDATE Jobs SET status = 'active', proof_image_url = NULL WHERE id = ?",
					[jobId],
				);
				return res.json({ message: "Objective rejected and pushed back to active" });
			}
		}

		return res
			.status(403)
			.json({ error: "You do not have permission to review this objective." });
	} catch (error) {
		console.error("Error rejecting job:", error);
		res.status(500).json({ error: "Internal server error" });
	}
});

// -------------------- Delete objective --------------------

/**
 * Delete a job. Only the user who created it can delete it.
 */
app.delete("/api/jobs/:id", requireAuth, async (req: Request, res: Response) => {
	const jobId = req.params.id;
	try {
		const job = await db.get<Job>("SELECT * FROM Jobs WHERE id = ?", [jobId]);
		if (!job) return res.status(404).json({ error: "Job not found" });

		if (String(job.created_by) !== String(req.userId)) {
			return res
				.status(403)
				.json({ error: "Only the publisher of this objective can delete it." });
		}

		await db.run("DELETE FROM Jobs WHERE id = ?", [jobId]);
		res.json({ message: "Objective deleted" });
	} catch (error) {
		console.error("Error deleting job:", error);
		res.status(500).json({ error: "Internal server error" });
	}
});

// -------------------- Chief Lead: user management --------------------

/**
 * Retrieve all users (id, username, role). Chief leads only.
 */
app.get("/api/users", requireAuth, requireChiefLead, async (_req: Request, res: Response) => {
	try {
		const users = await db.all<User[]>("SELECT id, username, role FROM Users");
		res.json({ users });
	} catch (err) {
		res.status(500).json({ error: "Error fetching users" });
	}
});

/**
 * Create a new user. Only chief leads can do this.
 * Enforces a maximum of three chief leads.
 */
app.post("/api/users", requireAuth, requireChiefLead, async (req: Request, res: Response) => {
	const { username, password, role } = req.body;
	if (!username || !password || !role) return res.status(400).json({ error: "Missing fields" });
	try {
		if (role === "chief_lead") {
			const countRow = await db.get<{ count: number }>(
				"SELECT COUNT(*) as count FROM Users WHERE role = 'chief_lead'",
			);
			if (countRow && countRow.count >= 3)
				return res.status(403).json({ error: "Maximum limit of 3 chief leads reached." });
		}
		const hash = await bcrypt.hash(password, 10);
		await db.run("INSERT INTO Users (username, password_hash, role) VALUES (?, ?, ?)", [
			username,
			hash,
			role,
		]);
		res.status(201).json({ message: "User created" });
	} catch (err: any) {
		if (err.message && err.message.includes("UNIQUE constraint"))
			return res.status(400).json({ error: "Username taken" });
		res.status(500).json({ error: "Error creating user" });
	}
});

/**
 * Delete a user. Only chief leads can do this.
 */
app.delete("/api/users/:id", requireAuth, requireChiefLead, async (req: Request, res: Response) => {
	try {
		await db.run("DELETE FROM Users WHERE id = ?", [req.params.id]);
		res.json({ message: "User deleted" });
	} catch (err) {
		res.status(500).json({ error: "Error deleting user" });
	}
});

// -------------------- Chief Lead: team management --------------------

/**
 * Retrieve all teams with their members. Chief leads only.
 */
app.get("/api/teams", requireAuth, requireChiefLead, async (_req: Request, res: Response) => {
	try {
		const teams = await db.all<TeamWithMembers[]>("SELECT * FROM Teams");
		for (const team of teams) {
			// Explicitly cast the result of db.all to an array of TeamMemberWithUser
			const members = (await db.all(
				`SELECT u.id, u.username, tm.role_in_team, u.role
                 FROM Users u
                 JOIN Team_Members tm ON u.id = tm.user_id
                 WHERE tm.team_id = ?`,
				[team.id],
			)) as TeamMemberWithUser[];
			team.members = members;
		}
		res.json({ teams });
	} catch (err) {
		res.status(500).json({ error: "Error fetching teams" });
	}
});

/**
 * Create a new team. Chief leads only.
 */
app.post("/api/teams", requireAuth, requireChiefLead, async (req: Request, res: Response) => {
	const { name } = req.body;
	if (!name) return res.status(400).json({ error: "Team name required" });
	try {
		const result = await db.run("INSERT INTO Teams (name, created_by) VALUES (?, ?)", [
			name,
			req.userId,
		]);
		res.status(201).json({ message: "Team created", teamId: result.lastID });
	} catch (err) {
		res.status(500).json({ error: "Error creating team" });
	}
});

/**
 * Add a member to a team (any role). Chief leads only.
 */
app.post(
	"/api/teams/:id/members",
	requireAuth,
	requireChiefLead,
	async (req: Request, res: Response) => {
		const { user_id, role_in_team } = req.body;
		try {
			await db.run(
				"INSERT INTO Team_Members (team_id, user_id, role_in_team) VALUES (?, ?, ?)",
				[req.params.id, user_id, role_in_team],
			);
			res.status(201).json({ message: "Member added" });
		} catch (err) {
			res.status(500).json({ error: "Error assigning member" });
		}
	},
);

// -------------------- Leader: add members to their team --------------------

/**
 * Allow a leader to add a member (only members, not leaders) to a team they lead.
 */
app.post("/api/leader/teams/:id/members", requireAuth, async (req: Request, res: Response) => {
	const { user_id } = req.body;
	try {
		// Verify the requester is a leader in this team
		const membership = await db.get<TeamMember>(
			"SELECT * FROM Team_Members WHERE team_id = ? AND user_id = ? AND role_in_team = 'leader'",
			[req.params.id, req.userId],
		);
		if (!membership)
			return res.status(403).json({ error: "You are not a leader in this team." });

		// Verify target user is a member (not leader/chief_lead)
		const targetUser = await db.get<User>("SELECT role FROM Users WHERE id = ?", [user_id]);
		if (!targetUser) return res.status(404).json({ error: "User not found" });
		if (targetUser.role !== "member")
			return res
				.status(403)
				.json({ error: "Leaders can only add members to teams, not other leaders." });

		await db.run(
			"INSERT INTO Team_Members (team_id, user_id, role_in_team) VALUES (?, ?, 'member')",
			[req.params.id, user_id],
		);
		res.status(201).json({ message: "Member added to team" });
	} catch (err) {
		res.status(500).json({ error: "Error adding member" });
	}
});

// -------------------- Leader: team jobs & events --------------------

/**
 * Post a team job. Only leaders of that team can do this.
 */
app.post("/api/admin/teams/:id/jobs", requireAuth, async (req: Request, res: Response) => {
	const { title, description } = req.body;
	if (!title) return res.status(400).json({ error: "Title required" });
	try {
		// Verify the requester is a leader in this specific team
		const membership = await db.get<TeamMember>(
			"SELECT * FROM Team_Members WHERE team_id = ? AND user_id = ? AND role_in_team = 'leader'",
			[req.params.id, req.userId],
		);
		if (!membership)
			return res
				.status(403)
				.json({ error: "You must be a leader of this team to post team objectives." });

		const result = await db.run(
			"INSERT INTO Jobs (title, description, team_id, created_by) VALUES (?, ?, ?, ?)",
			[title, description, req.params.id, req.userId],
		);
		res.status(201).json({ message: "Team job posted", jobId: result.lastID });
	} catch (err) {
		res.status(500).json({ error: "Error posting team job" });
	}
});

/**
 * Create a team event. Only leaders of that team can do this.
 */
app.post("/api/admin/teams/:id/events", requireAuth, async (req: Request, res: Response) => {
	const { title, start_date, end_date } = req.body;
	if (!title) return res.status(400).json({ error: "Title required" });
	try {
		// Verify the requester is a leader in this specific team
		const membership = await db.get<TeamMember>(
			"SELECT * FROM Team_Members WHERE team_id = ? AND user_id = ? AND role_in_team = 'leader'",
			[req.params.id, req.userId],
		);
		if (!membership)
			return res
				.status(403)
				.json({ error: "You must be a leader of this team to add events." });

		await db.run(
			"INSERT INTO Team_Events (team_id, title, start_date, end_date) VALUES (?, ?, ?, ?)",
			[req.params.id, title, start_date, end_date],
		);
		res.status(201).json({ message: "Team event created" });
	} catch (err) {
		res.status(500).json({ error: "Error creating event" });
	}
});

// -------------------- All users: my teams --------------------

/**
 * Retrieve all teams the authenticated user belongs to,
 * including jobs, events, and members of those teams.
 */
app.get("/api/teams/my-teams", requireAuth, async (req: Request, res: Response) => {
	try {
		const teams = await db.all<MyTeam[]>(
			`SELECT t.id, t.name, tm.role_in_team 
             FROM Teams t
             JOIN Team_Members tm ON t.id = tm.team_id
             WHERE tm.user_id = ?`,
			[req.userId],
		);
		for (const team of teams) {
			team.jobs = await db.all<Job[]>("SELECT * FROM Jobs WHERE team_id = ?", [team.id]);
			team.events = await db.all<TeamEvent[]>("SELECT * FROM Team_Events WHERE team_id = ?", [
				team.id,
			]);
			// Explicitly cast the result of db.all to an array of TeamMemberWithUser
			const members = (await db.all(
				`SELECT u.id, u.username, tm.role_in_team, u.role
                 FROM Users u
                 JOIN Team_Members tm ON u.id = tm.user_id
                 WHERE tm.team_id = ?`,
				[team.id],
			)) as TeamMemberWithUser[];
			team.members = members;
		}
		res.json({ teams });
	} catch (err) {
		res.status(500).json({ error: "Error fetching team data" });
	}
});

// -------------------- Get non-chief users (for leader member-add dropdown) --------------------

/**
 * Retrieve all users with role 'member'. Used by leaders when adding members to teams.
 */
app.get("/api/members-list", requireAuth, async (_req: Request, res: Response) => {
	try {
		const members = await db.all<User[]>(
			"SELECT id, username, role FROM Users WHERE role = 'member'",
		);
		res.json({ members });
	} catch (err) {
		res.status(500).json({ error: "Error fetching members" });
	}
});

// -------------------------------------------------------------------
// Start server
// -------------------------------------------------------------------

/**
 * Start the Express server on the configured port.
 */
app.listen(PORT, () => {
	console.log(`Server listening on port ${PORT}`);
});
