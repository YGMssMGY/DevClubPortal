import { getRole, logout, showToast, showLoading, escapeHtml } from "./auth.js";

// DOM elements
const role = getRole();
if (!role) window.location.href = "/login.html";

// Set user role badge
document.getElementById("userRoleBadge").innerHTML =
	`<span class="badge">${role.replace("_", " ").toUpperCase()}</span>`;

// Logout
document.getElementById("logoutBtn").addEventListener("click", logout);

// Get current user ID from cookie
const myUserId = document.cookie
	.split("; ")
	.find((r) => r.startsWith("userId="))
	?.split("=")[1];

// Show/hide UI based on role
const usersTab = document.getElementById("usersTab");
const leaderView = document.getElementById("leaderView");
const memberView = document.getElementById("memberView");
const chiefTeamsView = document.getElementById("chiefTeamsView");
const standardTeamsView = document.getElementById("standardTeamsView");

if (role === "chief_lead") {
	usersTab.classList.remove("hidden");
	leaderView.classList.remove("hidden");
	memberView.classList.remove("hidden");
	chiefTeamsView.classList.remove("hidden");
	standardTeamsView.classList.remove("hidden");
	document.getElementById("assigneeLabel").textContent = "Assignee (Leaders & Members)";
} else if (role === "leader") {
	leaderView.classList.remove("hidden");
	memberView.classList.remove("hidden");
	standardTeamsView.classList.remove("hidden");
	document.getElementById("assigneeLabel").textContent = "Assignee (Members Only)";
} else {
	memberView.classList.remove("hidden");
	standardTeamsView.classList.remove("hidden");
}

// Tab switching
const tabs = document.querySelectorAll(".tabs > .tab");
const contents = {
	workspace: document.getElementById("workspaceTab"),
	teams: document.getElementById("teamsTab"),
	users: document.getElementById("usersTabContent"),
};

tabs.forEach((tab) => {
	tab.addEventListener("click", () => {
		const tabId = tab.dataset.tab;
		if (!tabId) return;
		tabs.forEach((t) => t.classList.remove("active"));
		tab.classList.add("active");
		Object.values(contents).forEach((c) => c.classList.remove("active"));
		contents[tabId].classList.add("active");
	});
});

// Sub-tabs for jobs
const subTabs = document.querySelectorAll(".sub-tabs .tab");
const jobContainers = {
	active: document.getElementById("activeJobs"),
	submitted: document.getElementById("submittedJobs"),
	archived: document.getElementById("archivedJobs"),
};
subTabs.forEach((tab) => {
	tab.addEventListener("click", () => {
		const subTabId = tab.dataset.subtab;
		subTabs.forEach((t) => t.classList.remove("active"));
		tab.classList.add("active");
		Object.values(jobContainers).forEach((c) => c.classList.remove("active"));
		jobContainers[subTabId].classList.add("active");
	});
});

// ========== Leader/Chief Workspace ==========
async function fetchLeaderWorkspace() {
	const grid = document.getElementById("allUsersGrid");
	showLoading(grid);
	try {
		const res = await fetch("/api/admin/users");
		if (res.status === 401 || res.status === 403) window.location.href = "/login.html";
		const data = await res.json();
		renderLeaderWorkspace(data);
	} catch (err) {
		grid.innerHTML = '<div class="empty-state">Error loading data</div>';
	}
}

function renderLeaderWorkspace(data) {
	const grid = document.getElementById("allUsersGrid");
	const select = document.getElementById("assigneeSelect");
	grid.innerHTML = "";
	select.innerHTML = '<option value="">Select assignee...</option>';

	data.users.forEach((user) => {
		if (role === "chief_lead" && user.role !== "chief_lead") {
			select.innerHTML += `<option value="${user.id}">${escapeHtml(user.username)} (${user.role})</option>`;
		} else if (role === "leader" && user.role === "member") {
			select.innerHTML += `<option value="${user.id}">${escapeHtml(user.username)} (${user.role})</option>`;
		}

		let jobsHtml = "";
		if (user.jobs && user.jobs.length) {
			const sorted = user.jobs.sort((a, b) => (a.status === "submitted" ? -1 : 1));
			sorted.forEach((job) => {
				if (job.team_id !== null) return;
				const isSubmitted = job.status === "submitted";
				const isCreator = String(job.created_by) === String(myUserId);
				const canReview = role === "chief_lead" || isCreator;
				jobsHtml += `
          <div class="job-card mt-2">
            <div class="job-title">${escapeHtml(job.title)}</div>
            <div class="job-desc">${escapeHtml(job.description || "")}</div>
            ${job.proof_image_url ? `<img src="${job.proof_image_url}" class="proof-img">` : ""}
            <div class="job-meta">Status: ${job.status === "archived" ? "COMPLETED" : job.status.toUpperCase()}</div>
            ${
				isSubmitted && canReview
					? `
              <div class="review-actions">
                <button onclick="window.acceptJob(${job.id})" class="action-btn accept">Accept</button>
                <button onclick="window.rejectJob(${job.id})" class="action-btn reject">Reject</button>
              </div>
            `
					: ""
			}
            ${isCreator ? `<button onclick="window.deleteJob(${job.id})" class="action-btn delete mt-2">Delete</button>` : ""}
          </div>`;
			});
		}
		if (!jobsHtml) jobsHtml = '<div class="empty-state">No individual objectives</div>';

		grid.innerHTML += `
      <div class="card">
        <div class="card-header">
          <span class="card-title">${escapeHtml(user.username)}</span>
          <span class="card-badge">${user.role}</span>
        </div>
        ${jobsHtml}
      </div>`;
	});
}

// ========== Member Workspace ==========
async function fetchMemberWorkspace() {
	for (let key in jobContainers) {
		showLoading(jobContainers[key]);
	}
	try {
		const res = await fetch("/api/jobs");
		if (res.status === 401 || res.status === 403) window.location.href = "/login.html";
		const data = await res.json();
		renderMemberWorkspace(data);
	} catch (err) {
		Object.values(jobContainers).forEach(
			(c) => (c.innerHTML = '<div class="empty-state">Error loading jobs</div>'),
		);
	}
}

function renderMemberWorkspace(data) {
	const containers = {
		active: [],
		submitted: [],
		archived: [],
	};
	data.jobs.forEach((job) => {
		const html = `
      <div class="job-card">
        <div class="job-title">${escapeHtml(job.title)} ${job.team_id ? '<span class="text-sm">(Team Task)</span>' : ""}</div>
        <div class="job-desc">${escapeHtml(job.description || "")}</div>
        ${job.proof_image_url ? `<img src="${job.proof_image_url}" class="proof-img">` : ""}
        <div class="job-meta">Status: ${job.status === "archived" ? "COMPLETED" : job.status.toUpperCase()}</div>
        ${
			job.status === "active"
				? `
          <form onsubmit="submitProof(event, ${job.id});" class="mt-2">
            <input type="file" accept="image/*" class="form-control text-sm">
            <button type="submit" class="btn btn-primary w-100 mt-2">Submit Proof</button>
          </form>
        `
				: ""
		}
      </div>
    `;
		if (job.status === "active") containers.active.push(html);
		else if (job.status === "submitted") containers.submitted.push(html);
		else containers.archived.push(html);
	});
	jobContainers.active.innerHTML = containers.active.length
		? containers.active.join("")
		: '<div class="empty-state">No active tasks</div>';
	jobContainers.submitted.innerHTML = containers.submitted.length
		? containers.submitted.join("")
		: '<div class="empty-state">No submitted tasks</div>';
	jobContainers.archived.innerHTML = containers.archived.length
		? containers.archived.join("")
		: '<div class="empty-state">No completed tasks</div>';
}

// ========== My Teams ==========
async function fetchMyTeams() {
	const grid = document.getElementById("myTeamsGrid");
	showLoading(grid);
	try {
		const res = await fetch("/api/teams/my-teams");
		if (!res.ok) return;
		const { teams } = await res.json();
		await renderMyTeams(teams);
	} catch (err) {
		grid.innerHTML = '<div class="empty-state">Error loading teams</div>';
	}
}

async function renderMyTeams(teams) {
	const grid = document.getElementById("myTeamsGrid");
	grid.innerHTML = "";
	if (!teams.length) {
		grid.innerHTML = '<div class="empty-state">You are not in any teams yet</div>';
		return;
	}

	// Pre-fetch members for dropdown if leader
	let membersPromise = Promise.resolve([]);
	if (role === "leader") {
		membersPromise = fetch("/api/members-list")
			.then((res) => res.json())
			.then((data) => data.members || []);
	}

	// Build HTML synchronously (no await inside loop)
	let html = "";
	for (const t of teams) {
		const isTeamLeader = t.role_in_team === "leader";

		// Team objectives
		let jobsHtml = t.jobs
			.map((j) => {
				const isSubmitted = j.status === "submitted";
				const canReview = isTeamLeader || role === "chief_lead";
				const isCreator = String(j.created_by) === String(myUserId);
				return `
        <div class="job-card">
          <div class="job-title">${escapeHtml(j.title)}</div>
          <div class="job-desc">${escapeHtml(j.description || "")}</div>
          ${j.proof_image_url ? `<img src="${j.proof_image_url}" class="proof-img">` : ""}
          <div class="job-meta">Status: ${j.status === "archived" ? "COMPLETED" : j.status.toUpperCase()}</div>
          ${
				isSubmitted && canReview
					? `
            <div class="review-actions">
              <button onclick="window.acceptJob(${j.id})" class="action-btn accept">Accept</button>
              <button onclick="window.rejectJob(${j.id})" class="action-btn reject">Reject</button>
            </div>
          `
					: ""
			}
          ${isCreator ? `<button onclick="window.deleteJob(${j.id})" class="action-btn delete mt-2">Delete</button>` : ""}
        </div>`;
			})
			.join("");
		if (!jobsHtml) jobsHtml = '<div class="empty-state">No team objectives</div>';

		// Timeline
		let eventsHtml = t.events
			.map(
				(ev) => `
      <div class="timeline-event mb-3">
        <strong>${escapeHtml(ev.title)}</strong><br>
        <span class="text-sm">${ev.start_date || "?"} → ${ev.end_date || "?"}</span>
      </div>
    `,
			)
			.join("");
		if (!eventsHtml) eventsHtml = '<div class="empty-state">No events</div>';

		// Leader forms (static HTML with placeholders)
		let leaderForms = "";
		if (isTeamLeader) {
			leaderForms = `
        <div class="leader-forms">
          <form onsubmit="postTeamJob(event, ${t.id})" class="card-sm">
            <h5>Post Team Objective</h5>
            <input type="text" placeholder="Title" class="form-control" required>
            <input type="text" placeholder="Description" class="form-control mt-2" required>
            <button type="submit" class="btn btn-primary w-100 mt-2">Post</button>
          </form>
          <form onsubmit="postTeamEvent(event, ${t.id})" class="card-sm">
            <h5>Add Event</h5>
            <input type="text" placeholder="Title" class="form-control" required>
            <div class="flex gap-2 mt-2">
              <input type="date" class="form-control" required>
              <input type="date" class="form-control" required>
            </div>
            <button type="submit" class="btn btn-primary w-100 mt-2">Add</button>
          </form>
          <form onsubmit="addMemberToTeam(event, ${t.id})" class="card-sm">
            <h5>Add Member</h5>
            <select class="form-control leader-member-select" data-team="${t.id}" required><option value="">Loading...</option></select>
            <button type="submit" class="btn btn-primary w-100 mt-2">Add</button>
          </form>
        </div>`;
		}

		// Member list
		let membersHtml = t.members
			.map(
				(m) =>
					`<span class="badge mr-2">${escapeHtml(m.username)} (${m.role_in_team})</span>`,
			)
			.join("");

		html += `
      <div class="card">
        <div class="card-header">
          <span class="card-title">${escapeHtml(t.name)}</span>
          <span class="card-badge">${t.role_in_team}</span>
        </div>
        <div class="mb-3">${membersHtml}</div>
        <h4 class="mt-4 mb-2">Timeline</h4>
        <div class="timeline">${eventsHtml}</div>
        <h4 class="mt-4 mb-2">Objectives</h4>
        <div>${jobsHtml}</div>
        ${leaderForms}
      </div>`;
	}
	grid.innerHTML = html;

	// Populate member dropdowns after HTML is inserted
	if (role === "leader") {
		const members = await membersPromise;
		const selects = document.querySelectorAll(".leader-member-select");
		selects.forEach((sel) => {
			sel.innerHTML =
				'<option value="">Select member...</option>' +
				members
					.map((m) => `<option value="${m.id}">${escapeHtml(m.username)}</option>`)
					.join("");
		});
	}
}

// ========== Chief Lead: Team Builder ==========
async function fetchChiefTeams() {
	const grid = document.getElementById("chiefTeamsGrid");
	showLoading(grid);
	try {
		const [teamsRes, usersRes] = await Promise.all([fetch("/api/teams"), fetch("/api/users")]);
		if (!teamsRes.ok || !usersRes.ok) return;
		const { teams } = await teamsRes.json();
		const { users } = await usersRes.json();
		renderChiefTeams(teams, users);
	} catch (err) {
		grid.innerHTML = '<div class="empty-state">Error loading teams</div>';
	}
}

function renderChiefTeams(teams, users) {
	const grid = document.getElementById("chiefTeamsGrid");
	grid.innerHTML = "";
	const userOptions = users
		.filter((u) => u.role !== "chief_lead")
		.map((u) => `<option value="${u.id}">${escapeHtml(u.username)} (${u.role})</option>`)
		.join("");
	teams.forEach((t) => {
		let membersHtml = t.members
			.map((m) => `<div>• ${escapeHtml(m.username)} (${m.role_in_team})</div>`)
			.join("");
		if (!membersHtml) membersHtml = '<div class="empty-state">No members</div>';
		grid.innerHTML += `
      <div class="card">
        <div class="card-header">
          <span class="card-title">${escapeHtml(t.name)}</span>
        </div>
        <div class="mb-3">${membersHtml}</div>
        <form onsubmit="assignToTeam(event, ${t.id})" class="mt-4">
          <select class="form-control" required><option value="">Select user...</option>${userOptions}</select>
          <select class="form-control mt-2" required>
            <option value="member">As Member</option>
            <option value="leader">As Leader</option>
          </select>
          <button type="submit" class="btn btn-primary w-100 mt-2">Assign</button>
        </form>
      </div>`;
	});
}

// ========== User Management (Chief Lead) ==========
async function fetchUsersList() {
	const grid = document.getElementById("usersListGrid");
	showLoading(grid);
	try {
		const res = await fetch("/api/users");
		if (!res.ok) return;
		const { users } = await res.json();
		grid.innerHTML = users
			.map(
				(u) => `
      <div class="card flex-between">
        <div><strong>${escapeHtml(u.username)}</strong><br><span class="text-sm">${u.role}</span></div>
        <button onclick="window.deleteUser(${u.id})" class="action-btn delete">Expel</button>
      </div>
    `,
			)
			.join("");
	} catch (err) {
		grid.innerHTML = '<div class="empty-state">Error loading users</div>';
	}
}

// ========== Global functions (called from inline handlers) ==========
window.acceptJob = async (jobId) => {
	try {
		const res = await fetch(`/api/admin/jobs/${jobId}/accept`, { method: "POST" });
		if (res.ok) {
			showToast("Job accepted", "success");
			refreshAll();
		} else {
			const err = await res.json();
			showToast(err.error, "error");
		}
	} catch (e) {
		showToast("Network error", "error");
	}
};

window.rejectJob = async (jobId) => {
	if (!confirm("Reject submission?")) return;
	try {
		const res = await fetch(`/api/admin/jobs/${jobId}/reject`, { method: "POST" });
		if (res.ok) {
			showToast("Job rejected", "info");
			refreshAll();
		} else {
			const err = await res.json();
			showToast(err.error, "error");
		}
	} catch (e) {
		showToast("Network error", "error");
	}
};

window.deleteJob = async (jobId) => {
	if (!confirm("Delete this objective?")) return;
	try {
		const res = await fetch(`/api/jobs/${jobId}`, { method: "DELETE" });
		if (res.ok) {
			showToast("Job deleted", "success");
			refreshAll();
		} else {
			const err = await res.json();
			showToast(err.error, "error");
		}
	} catch (e) {
		showToast("Network error", "error");
	}
};

window.deleteUser = async (userId) => {
	if (!confirm("Delete this user?")) return;
	try {
		const res = await fetch(`/api/users/${userId}`, { method: "DELETE" });
		if (res.ok) {
			showToast("User deleted", "success");
			refreshAll();
			fetchUsersList();
			fetchChiefTeams();
		} else {
			const err = await res.json();
			showToast(err.error, "error");
		}
	} catch (e) {
		showToast("Network error", "error");
	}
};

window.submitProof = async (e, jobId) => {
	e.preventDefault();
	const fileInput = e.target.querySelector('input[type="file"]');
	if (!fileInput.files.length) {
		showToast("Select an image", "error");
		return;
	}
	const formData = new FormData();
	formData.append("proofImage", fileInput.files[0]);
	const btn = e.target.querySelector('button[type="submit"]');
	const original = btn.textContent;
	btn.disabled = true;
	btn.innerHTML = '<span class="spinner"></span> Uploading...';
	try {
		const res = await fetch(`/api/jobs/${jobId}/submit`, { method: "POST", body: formData });
		if (res.ok) {
			showToast("Proof submitted", "success");
			refreshAll();
		} else {
			const err = await res.json();
			showToast(err.error, "error");
		}
	} catch (e) {
		showToast("Network error", "error");
	} finally {
		btn.disabled = false;
		btn.innerHTML = original;
	}
};

window.assignToTeam = async (e, teamId) => {
	e.preventDefault();
	const selects = e.target.querySelectorAll("select");
	const userId = selects[0].value;
	const roleInTeam = selects[1].value;
	if (!userId) return;
	const res = await fetch(`/api/teams/${teamId}/members`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ user_id: userId, role_in_team: roleInTeam }),
	});
	if (res.ok) {
		showToast("Member assigned", "success");
		refreshAll();
	} else {
		const err = await res.json();
		showToast(err.error, "error");
	}
};

window.postTeamJob = async (e, teamId) => {
	e.preventDefault();
	const inputs = e.target.querySelectorAll("input");
	const title = inputs[0].value;
	const desc = inputs[1]?.value || "";
	if (!title) return;
	const res = await fetch(`/api/admin/teams/${teamId}/jobs`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ title, description: desc }),
	});
	if (res.ok) {
		showToast("Team job posted", "success");
		refreshAll();
	} else {
		const err = await res.json();
		showToast(err.error, "error");
	}
	e.target.reset();
};

window.postTeamEvent = async (e, teamId) => {
	e.preventDefault();
	const inputs = e.target.querySelectorAll("input");
	const title = inputs[0].value;
	const start = inputs[1].value;
	const end = inputs[2].value;
	if (!title || !start || !end) return;
	const res = await fetch(`/api/admin/teams/${teamId}/events`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ title, start_date: start, end_date: end }),
	});
	if (res.ok) {
		showToast("Event added", "success");
		refreshAll();
	} else {
		const err = await res.json();
		showToast(err.error, "error");
	}
	e.target.reset();
};

window.addMemberToTeam = async (e, teamId) => {
	e.preventDefault();
	const select = e.target.querySelector("select");
	const userId = select.value;
	if (!userId) return;
	const res = await fetch(`/api/leader/teams/${teamId}/members`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ user_id: userId }),
	});
	if (res.ok) {
		showToast("Member added", "success");
		refreshAll();
	} else {
		const err = await res.json();
		showToast(err.error, "error");
	}
};

// ========== Assign individual objective ==========
document.getElementById("assignJobForm")?.addEventListener("submit", async (e) => {
	e.preventDefault();
	const title = document.getElementById("jobTitle").value.trim();
	const assigneeId = document.getElementById("assigneeSelect").value;
	const desc = document.getElementById("jobDesc").value;
	if (!title || !assigneeId) {
		showToast("Title and assignee required", "error");
		return;
	}
	const btn = e.target.querySelector('button[type="submit"]');
	const original = btn.textContent;
	btn.disabled = true;
	btn.innerHTML = '<span class="spinner"></span> Assigning...';
	try {
		const res = await fetch("/api/admin/jobs", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ title, description: desc, assigned_to_user_id: assigneeId }),
		});
		if (res.ok) {
			showToast("Job assigned", "success");
			e.target.reset();
			refreshAll();
		} else {
			const err = await res.json();
			showToast(err.error, "error");
		}
	} catch (e) {
		showToast("Network error", "error");
	} finally {
		btn.disabled = false;
		btn.innerHTML = original;
	}
});

// ========== Create team ==========
document.getElementById("createTeamForm")?.addEventListener("submit", async (e) => {
	e.preventDefault();
	const name = document.getElementById("teamName").value.trim();
	if (!name) return;
	const res = await fetch("/api/teams", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ name }),
	});
	if (res.ok) {
		showToast("Team created", "success");
		document.getElementById("createTeamForm").reset();
		refreshAll();
	} else {
		const err = await res.json();
		showToast(err.error, "error");
	}
});

// ========== Create user ==========
document.getElementById("createUserForm")?.addEventListener("submit", async (e) => {
	e.preventDefault();
	const username = document.getElementById("newUsername").value.trim();
	const password = document.getElementById("newPassword").value;
	const role = document.getElementById("newRole").value;
	if (!username || !password) {
		showToast("Username and password required", "error");
		return;
	}
	const btn = e.target.querySelector('button[type="submit"]');
	const original = btn.textContent;
	btn.disabled = true;
	btn.innerHTML = '<span class="spinner"></span> Creating...';
	try {
		const res = await fetch("/api/users", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ username, password, role }),
		});
		if (res.ok) {
			showToast("User created", "success");
			e.target.reset();
			refreshAll();
			fetchUsersList();
			fetchChiefTeams();
		} else {
			const err = await res.json();
			showToast(err.error, "error");
		}
	} catch (e) {
		showToast("Network error", "error");
	} finally {
		btn.disabled = false;
		btn.innerHTML = original;
	}
});

// ========== Refresh all data ==========
function refreshAll() {
	if (role === "leader" || role === "chief_lead") fetchLeaderWorkspace();
	fetchMemberWorkspace();
	fetchMyTeams();
	if (role === "chief_lead") {
		fetchChiefTeams();
		fetchUsersList();
	}
}

// Initial load
refreshAll();
