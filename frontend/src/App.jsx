import { useEffect, useMemo, useState } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000/api";
const CATEGORIES = ["Pothole", "Garbage", "Streetlight", "Road Damage", "Water", "Other"];
const STATUS_FILTERS = ["All", "New", "Acknowledged", "In Progress", "Resolved"];
const MAX_PHOTO_BYTES = 1_000_000;
const MAX_PHOTOS = 4;
const TOKEN_STORAGE_KEY = "civicpulse-session-token";

async function fetchProfile(token) {
  const headers = { Authorization: `Bearer ${token}` };
  const [profileResponse, scoreResponse, supportsResponse] = await Promise.all([
    fetch(`${API}/auth/me`, { headers }),
    fetch(`${API}/users/me/score`, { headers }),
    fetch(`${API}/issues/support/me`, { headers })
  ]);
  const [profileResult, scoreResult, supportsResult] = await Promise.all([
    profileResponse.json(),
    scoreResponse.json(),
    supportsResponse.json()
  ]);
  if (!profileResponse.ok) throw new Error(profileResult.message || "Could not load your profile");
  if (!scoreResponse.ok) throw new Error(scoreResult.message || "Could not load your Civic Score");
  if (!supportsResponse.ok) throw new Error(supportsResult.message || "Could not load your community supports");
  return { user: profileResult.data, score: scoreResult.data, supportedIssueIds: supportsResult.data };
}

function readPhoto(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Date unavailable"
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function priorityClass(priority) {
  return (priority || "medium").toLowerCase();
}

function statusLabel(status) {
  if (status === "Open") return "New";
  if (status === "Assigned") return "Acknowledged";
  return status || "New";
}

function statusClass(status) {
  return statusLabel(status).toLowerCase().replaceAll(" ", "-");
}

function timelineLabel(event) {
  return event.changedBy === "Report submitted" ? "Submitted" : statusLabel(event.status);
}

function mapUrl(issues) {
  if (!issues.length) return "";
  const latitudes = issues.map((issue) => issue.location.lat);
  const longitudes = issues.map((issue) => issue.location.lng);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLng = Math.min(...longitudes);
  const maxLng = Math.max(...longitudes);
  const centerLat = (minLat + maxLat) / 2;
  const centerLng = (minLng + maxLng) / 2;
  const latSpan = Math.max(maxLat - minLat, 0.015);
  const lngSpan = Math.max(maxLng - minLng, 0.015);
  const bbox = [
    Math.max(-180, minLng - lngSpan * 0.25),
    Math.max(-90, minLat - latSpan * 0.25),
    Math.min(180, maxLng + lngSpan * 0.25),
    Math.min(90, maxLat + latSpan * 0.25)
  ].join(",");
  return `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${centerLat}%2C${centerLng}`;
}

function AdminReportRow({ issue, status, onStatusChange, onSave, saving }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <tr className="admin-table-row">
        <td><strong className="admin-table-id">{issue.trackingId || `#${String(issue._id).slice(-8)}`}</strong><span className="admin-table-title">{issue.title}</span><small>{issue.category}</small></td>
        <td><span className={`priority-pill ${priorityClass(issue.priority)}`}>{issue.priority || "Medium"}</span></td>
        <td><span className={`badge ${statusClass(issue.status)}`}>{statusLabel(issue.status)}</span></td>
        <td className="admin-location-cell">{issue.location?.address || "Not provided"}</td>
        <td><time>{formatDate(issue.createdAt)}</time></td>
        <td>
          <button type="button" className="details-toggle admin-review-toggle" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? "Close" : "Review"}</button>
          <div className="admin-status-control">
            <label className="admin-status-select"><span className="visually-hidden">Update report status</span><select value={status} onChange={(event) => onStatusChange(event.target.value)}>{STATUS_FILTERS.slice(1).map((value) => <option key={value}>{value}</option>)}</select></label>
            <button type="button" className="primary-button admin-save" onClick={onSave} disabled={saving || statusLabel(issue.status) === status}>{saving ? "Saving..." : "Save"}</button>
          </div>
        </td>
      </tr>
      {expanded && <tr className="admin-expanded-row"><td colSpan="6">
        <p>{issue.description || "No description provided."}</p>
        <p className="admin-support-count">{issue.supportCount || 0} community supports</p>
        {issue.statusHistory?.length ? <div className="timeline"><strong>Status timeline</strong>{issue.statusHistory.map((event, index) => <div className="timeline-event" key={`${event.status}-${event.changedAt}-${index}`}><span className="timeline-marker" /><div><span>{timelineLabel(event)}</span><time>{formatDate(event.changedAt)}</time></div></div>)}</div> : <p className="legacy-note">No historical status changes were recorded for this report.</p>}
      </td></tr>}
    </>
  );
}

export default function App() {
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [issueSummary, setIssueSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [issueDetails, setIssueDetails] = useState({});
  const [detailLoading, setDetailLoading] = useState("");
  const [passwordResetToken, setPasswordResetToken] = useState(() =>
    new URLSearchParams(window.location.search).get("resetToken") || ""
  );
  const [token, setToken] = useState(() =>
    new URLSearchParams(window.location.search).has("resetToken")
      ? ""
      : window.sessionStorage.getItem(TOKEN_STORAGE_KEY) || ""
  );
  const [currentUser, setCurrentUser] = useState(null);
  const [civicScore, setCivicScore] = useState(null);
  const [supportedIssueIds, setSupportedIssueIds] = useState([]);
  const [supportLoadingId, setSupportLoadingId] = useState("");
  const [profileLoading, setProfileLoading] = useState(false);
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authMode, setAuthMode] = useState(() => passwordResetToken ? "reset" : "login");
  const [authForm, setAuthForm] = useState({ displayName: "", email: "", password: "", confirmPassword: "" });
  const [page, setPage] = useState(() => passwordResetToken ? "profile" : "home");
  const [adminKey, setAdminKey] = useState("");
  const [adminKeyInput, setAdminKeyInput] = useState("");
  const [adminDashboard, setAdminDashboard] = useState(null);
  const [adminView, setAdminView] = useState("dashboard");
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminStatusDrafts, setAdminStatusDrafts] = useState({});
  const [adminUpdatingId, setAdminUpdatingId] = useState("");
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("info");
  const [duplicate, setDuplicate] = useState(null);
  const [activeView, setActiveView] = useState("feed");
  const [statusFilter, setStatusFilter] = useState("All");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [showAllReports, setShowAllReports] = useState(false);
  const [search, setSearch] = useState("");
  const [expandedIssue, setExpandedIssue] = useState("");
  const [form, setForm] = useState({
    title: "", description: "", category: "Pothole", address: "", lat: "", lng: "", photos: []
  });

  async function loadIssues() {
    setLoading(true);
    try {
      const response = await fetch(`${API}/issues`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Could not load reports");
      setIssues(result.data || []);
      setMessage("");
    } catch (error) {
      setMessage(`${error.message}. Check that the backend and database are running.`);
      setMessageType("error");
    } finally {
      setLoading(false);
    }
  }

  async function loadIssueSummary() {
    setSummaryLoading(true);
    try {
      const response = await fetch(`${API}/issues/summary`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Could not load community statistics");
      setIssueSummary(result.data);
      setSummaryError("");
    } catch (error) {
      setIssueSummary(null);
      setSummaryError(error.message);
    } finally {
      setSummaryLoading(false);
    }
  }

  useEffect(() => {
    window.sessionStorage.removeItem("civicpulse-admin-key");
  }, []);

  useEffect(() => {
    loadIssues();
    loadIssueSummary();
  }, []);

  useEffect(() => {
    if (!token) return undefined;
    let active = true;
    setProfileLoading(true);
    fetchProfile(token)
      .then((profile) => {
        if (!active) return;
        setCurrentUser(profile.user);
        setCivicScore(profile.score);
        setSupportedIssueIds(profile.supportedIssueIds);
      })
      .catch((error) => {
        if (!active) return;
        window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
        setToken("");
        setCurrentUser(null);
        setCivicScore(null);
        setSupportedIssueIds([]);
        setMessage(error.message);
        setMessageType("error");
      })
      .finally(() => {
        if (active) setProfileLoading(false);
      });
    return () => { active = false; };
  }, [token]);

  function updateField(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
    setDuplicate(null);
  }

  async function addPhotos(event) {
    const selected = [...event.target.files];
    event.target.value = "";
    if (!selected.length) return;

    const availableSlots = MAX_PHOTOS - form.photos.length;
    if (selected.length > availableSlots) {
      setMessage(`You can attach up to ${MAX_PHOTOS} photos.`);
      setMessageType("error");
      return;
    }
    const invalid = selected.find((file) =>
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > MAX_PHOTO_BYTES
    );
    if (invalid) {
      setMessage("Choose JPEG, PNG, or WebP photos smaller than 1 MB each.");
      setMessageType("error");
      return;
    }

    try {
      const photos = await Promise.all(selected.map(readPhoto));
      setForm((current) => ({ ...current, photos: [...current.photos, ...photos] }));
      setMessage("");
    } catch (error) {
      setMessage(error.message);
      setMessageType("error");
    }
  }

  function captureLocation() {
    if (!navigator.geolocation) {
      setMessage("Location capture is not supported by this browser.");
      setMessageType("error");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setForm((current) => ({
          ...current,
          lat: coords.latitude.toFixed(6),
          lng: coords.longitude.toFixed(6)
        }));
        setMessage("Location added to your report.");
        setMessageType("success");
      },
      (error) => {
        setMessage(error.message || "Could not get your location. Check browser location permissions.");
        setMessageType("error");
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  async function submitIssue(event, allowDuplicate = false) {
    event?.preventDefault();
    if (!token || !currentUser) {
      setPage("profile");
      setMessage("Sign in or create an account to submit a report and earn 10 Civic Score points.");
      setMessageType("info");
      return;
    }
    setSubmitting(true);
    setMessage("");
    setDuplicate(null);
    try {
      const response = await fetch(`${API}/issues`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...form, allowDuplicate })
      });
      const result = await response.json();
      if (response.status === 409 && result.code === "POSSIBLE_DUPLICATE") {
        setDuplicate(result.data);
        setMessage(result.message);
        setMessageType("warning");
        return;
      }
      if (!response.ok) throw new Error(result.message || "Could not submit report");

      setForm({ title: "", description: "", category: "Pothole", address: "", lat: "", lng: "", photos: [] });
      await loadIssues();
      await loadIssueSummary();
      try {
        const profile = await fetchProfile(token);
        setCivicScore(profile.score);
        setSupportedIssueIds(profile.supportedIssueIds);
      } catch (error) {
        setMessage(`Report submitted, but your profile could not refresh: ${error.message}`);
        setMessageType("warning");
        return;
      }
      setMessage("Your report is live. Thanks for helping your community.");
      setMessageType("success");
    } catch (error) {
      setMessage(error.message);
      setMessageType("error");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitAuth(event) {
    event.preventDefault();
    setAuthSubmitting(true);
    setMessage("");
    try {
      if (authMode === "reset" && authForm.password !== authForm.confirmPassword) {
        throw new Error("The passwords do not match.");
      }
      const endpoint = authMode === "register"
        ? "register"
        : authMode === "forgot"
          ? "forgot-password"
          : authMode === "reset"
            ? "reset-password"
            : "login";
      if (authMode === "forgot") {
        const response = await fetch(`${API}/auth/${endpoint}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: authForm.email })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || "Could not request a password reset");
        setMessage(result.message);
        setMessageType("success");
        return;
      }
      if (authMode === "reset") {
        const response = await fetch(`${API}/auth/${endpoint}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: passwordResetToken, password: authForm.password })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || "Could not reset your password");
        setPasswordResetToken("");
        const resetUrl = new URL(window.location.href);
        resetUrl.searchParams.delete("resetToken");
        window.history.replaceState({}, "", resetUrl);
        setAuthForm((current) => ({ ...current, password: "", confirmPassword: "" }));
        setAuthMode("login");
        setMessage(result.message);
        setMessageType("success");
        return;
      }
      const response = await fetch(`${API}/auth/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(authForm)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Could not sign in");

      window.sessionStorage.setItem(TOKEN_STORAGE_KEY, result.data.token);
      setCurrentUser(result.data.user);
      setToken(result.data.token);
      setPage("profile");
      setAuthForm({ displayName: "", email: "", password: "", confirmPassword: "" });
      const scoreResult = await fetch(`${API}/users/me/score`, {
        headers: { Authorization: `Bearer ${result.data.token}` }
      });
      const scorePayload = await scoreResult.json();
      if (!scoreResult.ok) throw new Error(scorePayload.message || "Could not load your Civic Score");
      setCivicScore(scorePayload.data);
      const supportsResponse = await fetch(`${API}/issues/support/me`, {
        headers: { Authorization: `Bearer ${result.data.token}` }
      });
      const supportsResult = await supportsResponse.json();
      if (!supportsResponse.ok) throw new Error(supportsResult.message || "Could not load your community supports");
      setSupportedIssueIds(supportsResult.data);
      setMessage(authMode === "register" ? "Welcome to CivicPulse. Your profile is ready." : "Welcome back.");
      setMessageType("success");
    } catch (error) {
      setMessage(error.message);
      setMessageType("error");
    } finally {
      setAuthSubmitting(false);
    }
  }

  function signOut() {
    window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    setToken("");
    setCurrentUser(null);
    setCivicScore(null);
    setSupportedIssueIds([]);
    setPage("home");
    setMessage("You have signed out.");
    setMessageType("success");
  }

  async function setIssueSupported(issueId, supported) {
    if (!token || !currentUser) {
      setPage("profile");
      setMessage("Sign in to support a report.");
      setMessageType("info");
      return;
    }
    setSupportLoadingId(issueId);
    try {
      const response = await fetch(`${API}/issues/${issueId}/support`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ supported })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Could not update your support");
      setIssues((current) => current.map((issue) => issue._id === issueId
        ? { ...issue, supportCount: result.data.supportCount }
        : issue));
      setIssueDetails((current) => current[issueId]
        ? { ...current, [issueId]: { ...current[issueId], supportCount: result.data.supportCount } }
        : current);
      setSupportedIssueIds((current) => result.data.supported
        ? [...new Set([...current, issueId])]
        : current.filter((id) => id !== issueId));
      await loadIssueSummary();
      setMessage(result.data.supported ? "You supported this report." : "Your support was removed.");
      setMessageType("success");
    } catch (error) {
      setMessage(error.message);
      setMessageType("error");
    } finally {
      setSupportLoadingId("");
    }
  }

  async function loadAdminDashboard(key) {
    setAdminLoading(true);
    setMessage("");
    try {
      const response = await fetch(`${API}/admin/dashboard`, {
        headers: { Authorization: `Bearer ${key}` }
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Could not load administrator dashboard");
      setAdminDashboard(result.data);
      setAdminKey(key);
      setAdminStatusDrafts(Object.fromEntries(result.data.recentReports.map((issue) => [issue._id, statusLabel(issue.status)])));
      return true;
    } catch (error) {
      setMessage(error.message);
      setMessageType("error");
      if (responseInvalidCredential(error)) {
        setAdminDashboard(null);
        setAdminKey("");
      }
      return false;
    } finally {
      setAdminLoading(false);
    }
  }

  function responseInvalidCredential(error) {
    return error.message === "Valid admin credentials are required"
      || error.message === "Administrator access is not configured. Set ADMIN_API_KEY on the backend.";
  }

  async function submitAdminKey(event) {
    event.preventDefault();
    if (!adminKeyInput.trim()) {
      setMessage("Enter the administrator API key to continue.");
      setMessageType("error");
      return;
    }
    const authorized = await loadAdminDashboard(adminKeyInput.trim());
    if (authorized) setAdminKeyInput("");
  }

  async function updateAdminIssueStatus(issueId) {
    const status = adminStatusDrafts[issueId];
    if (!status) return;
    setAdminUpdatingId(issueId);
    setMessage("");
    try {
      const response = await fetch(`${API}/issues/${issueId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminKey}` },
        body: JSON.stringify({ status })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Could not update report status");
      const refreshed = await loadAdminDashboard(adminKey);
      await loadIssues();
      await loadIssueSummary();
      setMessage(refreshed
        ? `${result.data.trackingId || "Report"} status updated to ${result.data.status}.`
        : "Status updated, but the dashboard could not refresh. Use the refresh button to retry.");
      setMessageType(refreshed ? "success" : "error");
    } catch (error) {
      setMessage(error.message);
      setMessageType("error");
    } finally {
      setAdminUpdatingId("");
    }
  }

  function openAdminDashboard() {
    setPage("admin");
    setAdminView("dashboard");
    setMessage("");
  }

  function openCommunityMap() {
    setActiveView("map");
    requestAnimationFrame(() => document.getElementById("community")?.scrollIntoView({ behavior: "smooth" }));
  }

  async function toggleIssueDetails(issueId) {
    if (expandedIssue === issueId) {
      setExpandedIssue("");
      return;
    }
    setExpandedIssue(issueId);
    if (issueDetails[issueId]) return;

    setDetailLoading(issueId);
    try {
      const response = await fetch(`${API}/issues/${issueId}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Could not load report details");
      setIssueDetails((current) => ({ ...current, [issueId]: result.data }));
    } catch (error) {
      setMessage(error.message);
      setMessageType("error");
    } finally {
      setDetailLoading("");
    }
  }

  async function viewDuplicateReport() {
    if (!duplicate?._id) return;
    const issueId = duplicate._id;
    setPage("home");
    setActiveView("feed");
    setExpandedIssue(issueId);
    requestAnimationFrame(() => document.getElementById("community")?.scrollIntoView({ behavior: "smooth" }));
    if (issueDetails[issueId]) return;
    setDetailLoading(issueId);
    try {
      const response = await fetch(`${API}/issues/${issueId}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Could not load the suggested report");
      setIssueDetails((current) => ({ ...current, [issueId]: result.data }));
    } catch (error) {
      setMessage(error.message);
      setMessageType("error");
    } finally {
      setDetailLoading("");
    }
  }

  const mappedIssues = issues.filter((issue) =>
    Number.isFinite(issue.location?.lat) && Number.isFinite(issue.location?.lng)
  );
  const filteredIssues = useMemo(() => issues.filter((issue) => {
    const matchesStatus = statusFilter === "All" || statusLabel(issue.status) === statusFilter;
    const matchesCategory = categoryFilter === "All" || issue.category === categoryFilter;
    const text = `${issue.title} ${issue.description || ""} ${issue.category} ${issue.location?.address || ""} ${issue.trackingId || ""}`.toLowerCase();
    return matchesStatus && matchesCategory && text.includes(search.trim().toLowerCase());
  }), [issues, search, statusFilter, categoryFilter]);
  const visibleIssues = showAllReports ? filteredIssues : filteredIssues.slice(0, 4);
  const adminMappedReports = (adminDashboard?.recentReports || []).filter((issue) =>
    Number.isFinite(issue.location?.lat) && Number.isFinite(issue.location?.lng)
  );
  const hotspots = useMemo(() => {
    const groups = new Map();
    for (const issue of mappedIssues) {
      const key = `${issue.location.lat.toFixed(2)},${issue.location.lng.toFixed(2)}`;
      const group = groups.get(key) || { key, lat: issue.location.lat, lng: issue.location.lng, issues: [] };
      group.issues.push(issue);
      groups.set(key, group);
    }
    return [...groups.values()].sort((a, b) => b.issues.length - a.issues.length);
  }, [mappedIssues]);

  return (
    <main className="shell" id="top">
      <nav className="nav">
        <a className="brand" href="#" aria-label="CivicPulse home">
          <span className="brand-mark" aria-hidden="true">C</span><span>CivicPulse</span>
        </a>
        <div className="nav-right">
          {page === "home" && <>
            <a className="nav-link" href="#top">Home</a>
            <a className="nav-link" href="#community">Community reports</a>
            <button className="nav-link nav-map-link" onClick={openCommunityMap}>Issue map</button>
            <a className="nav-link" href="#about">About</a>
            <a className="nav-report" href="#report">Report an issue</a>
          </>}
          <button className="nav-link nav-profile" onClick={openAdminDashboard}>Administrator access <span>↗</span></button>
          <button className="nav-link nav-profile" onClick={() => { setPage(page === "profile" ? "home" : "profile"); setMessage(""); }}>
            {currentUser ? `Hi, ${currentUser.displayName}` : "Sign in"} <span>{page === "profile" ? "←" : "◉"}</span>
          </button>
        </div>
      </nav>
      {message && <div className={`notice ${messageType}`} role={messageType === "error" ? "alert" : "status"}>{message}</div>}

      {page === "admin" ? <section className="admin-page">
        <button className="back-link" onClick={() => { setPage("home"); setMessage(""); }}>← Back to community</button>
        {!adminDashboard ? <div className="panel auth-panel">
          <p className="eyebrow">RESTRICTED ADMIN AREA</p>
          <h1 className="auth-title">Administrator sign in</h1>
          <p className="auth-intro">Use the backend administrator API key configured by the project owner. This is separate from your citizen account.</p>
          <form onSubmit={submitAdminKey}>
            <label>Admin API key<input type="password" autoComplete="current-password" value={adminKeyInput} onChange={(event) => setAdminKeyInput(event.target.value)} required placeholder="Enter backend admin key" /></label>
            <button className="primary-button auth-submit" type="submit" disabled={adminLoading}><span>{adminLoading ? "Verifying access..." : "Open dashboard"}</span><span>↗</span></button>
          </form>
        </div> : <div className="admin-content">
          <div className="admin-console">
            <aside className="admin-sidebar">
              <a className="admin-brand" href="#top" onClick={(event) => { event.preventDefault(); setPage("home"); }}><span className="brand-mark">C</span><span>CivicPulse<small>ADMINISTRATION</small></span></a>
              <span className="admin-sidebar-label">WORKSPACE</span>
              <nav className="admin-sidebar-nav" aria-label="Administrator sections">
                <button className={adminView === "dashboard" ? "active" : ""} onClick={() => setAdminView("dashboard")}><span aria-hidden="true">▦</span> Dashboard</button>
                <button className={adminView === "reports" ? "active" : ""} onClick={() => setAdminView("reports")}><span aria-hidden="true">≡</span> Manage issues</button>
                <button className={adminView === "map" ? "active" : ""} onClick={() => setAdminView("map")}><span aria-hidden="true">⌖</span> Map view</button>
              </nav>
              <div className="admin-sidebar-footer">
                <span className="admin-sidebar-avatar">AK</span>
                <span><strong>Ankit Kumar</strong><small>Project Administrator</small></span>
              </div>
            </aside>
            <div className="admin-workspace">
              <header className="admin-topbar">
                <div><p className="eyebrow">CIVICPULSE · KIET INNOTECH 2026</p><h1>{adminView === "dashboard" ? "Dashboard" : adminView === "reports" ? "Manage issues" : "Issue map"}</h1></div>
                <div className="admin-topbar-actions"><span className="admin-identity"><strong>Ankit Kumar</strong><small>Project Administrator</small></span><button className="secondary-button" onClick={() => { setAdminDashboard(null); setAdminKey(""); setAdminView("dashboard"); }}>Lock dashboard</button><button className="refresh" onClick={() => loadAdminDashboard(adminKey)} disabled={adminLoading} aria-label="Refresh administrator data">Refresh</button></div>
              </header>
              {adminLoading && !adminDashboard ? <p className="empty">Loading dashboard data...</p> : adminDashboard && <>
                {adminView === "dashboard" && <>
                  <div className="admin-metrics">
                    <div className="admin-metric"><span>Total reports</span><strong>{adminDashboard.summary.totalReports}</strong><small>All community reports</small></div>
                    <div className="admin-metric pending"><span>Pending</span><strong>{adminDashboard.summary.pendingReports}</strong><small>New or acknowledged</small></div>
                    <div className="admin-metric progress"><span>In progress</span><strong>{adminDashboard.summary.inProgressReports}</strong><small>Being addressed</small></div>
                    <div className="admin-metric resolved"><span>Resolved</span><strong>{adminDashboard.summary.resolvedReports}</strong><small>Marked resolved</small></div>
                    <div className="admin-metric high"><span>High priority</span><strong>{adminDashboard.summary.highPriorityUnresolved}</strong><small>Unresolved reports</small></div>
                  </div>
                  <section className="admin-analytics">
                    <article className="panel analytics-card">
                      <div className="analytics-title"><div><p className="eyebrow">SERVICE PROGRESS</p><h3>Resolution rate</h3></div><span className="rate-value">{adminDashboard.summary.resolutionRate}%</span></div>
                      <div className="rate-track"><span style={{ width: `${adminDashboard.summary.resolutionRate}%` }} /></div>
                      <div className="rate-caption"><span>{adminDashboard.summary.resolvedReports} resolved</span><span>{adminDashboard.summary.totalReports} total</span></div>
                      <div className="resolution-split"><span><i className="resolved-key" />Resolved <strong>{adminDashboard.summary.resolvedReports}</strong></span><span><i className="unresolved-key" />Unresolved <strong>{adminDashboard.summary.totalReports - adminDashboard.summary.resolvedReports}</strong></span></div>
                    </article>
                    <article className="panel analytics-card">
                      <div className="analytics-title"><div><p className="eyebrow">REPORT VOLUME</p><h3>By category</h3></div></div>
                      {adminDashboard.reportsByCategory.length === 0 ? <p className="analytics-empty">No category data yet.</p> : <div className="bar-list">{adminDashboard.reportsByCategory.map((entry) => <div className="bar-row" key={entry.category}><div><span>{entry.category}</span><strong>{entry.count}</strong></div><div className="bar-track"><span style={{ width: `${Math.max(4, (entry.count / Math.max(adminDashboard.summary.totalReports, 1)) * 100)}%` }} /></div></div>)}</div>}
                    </article>
                    <article className="panel analytics-card status-analytics">
                      <div className="analytics-title"><div><p className="eyebrow">WORKFLOW</p><h3>By status</h3></div></div>
                      {adminDashboard.reportsByStatus.length === 0 ? <p className="analytics-empty">No status data yet.</p> : <div className="status-counts">{adminDashboard.reportsByStatus.map((entry) => <div key={entry.status}><span className={`badge ${statusClass(entry.status)}`}>{entry.status}</span><strong>{entry.count}</strong></div>)}</div>}
                    </article>
                  </section>
                </>}
                {adminView === "map" ? <section className="panel admin-map-panel">
                  <div className="admin-reports-heading"><div><p className="eyebrow">REPORT LOCATIONS</p><h3>Map view</h3></div><span>{adminMappedReports.length} mapped in latest {adminDashboard.recentReports.length} reports</span></div>
                  {adminMappedReports.length ? <div className="map-frame"><iframe title="Map of recent civic report locations" src={mapUrl(adminMappedReports)} loading="lazy" /></div> : <div className="empty-state"><div className="empty-icon">⌖</div><h3>No mapped reports in the latest data</h3><p>Reports appear here when a location with coordinates has been shared.</p></div>}
                </section> : <section className="panel admin-reports">
                  <div className="admin-reports-heading"><div><p className="eyebrow">{adminView === "reports" ? "REPORT MANAGEMENT" : "LATEST COMMUNITY ACTIVITY"}</p><h3>{adminView === "reports" ? "All recent reports" : "Recent issues"}</h3></div><span>{adminDashboard.recentReports.length} of up to 30</span></div>
                  {adminDashboard.recentReports.length === 0 ? <div className="empty-state"><div className="empty-icon">≡</div><h3>No reports to manage yet</h3><p>New community reports will appear here.</p></div> : <div className="admin-table-scroll"><table className="admin-report-table"><thead><tr><th>Report</th><th>Priority</th><th>Status</th><th>Location</th><th>Submitted</th><th>Review &amp; update</th></tr></thead><tbody>{adminDashboard.recentReports.slice(0, adminView === "dashboard" ? 5 : 30).map((issue) => <AdminReportRow key={issue._id} issue={issue} status={adminStatusDrafts[issue._id] || statusLabel(issue.status)} onStatusChange={(status) => setAdminStatusDrafts((current) => ({ ...current, [issue._id]: status }))} onSave={() => updateAdminIssueStatus(issue._id)} saving={adminUpdatingId === issue._id} />)}</tbody></table></div>}
                  {adminView === "dashboard" && adminDashboard.recentReports.length > 5 && <button className="show-more-reports" type="button" onClick={() => setAdminView("reports")}>Manage all {adminDashboard.recentReports.length} recent reports</button>}
                </section>}
              </>}
            </div>
          </div>
        </div>}
      </section> : page === "profile" ? <section className="profile-page">
        <button className="back-link" onClick={() => { setPage("home"); setMessage(""); }}>← Back to CivicPulse</button>
        {currentUser ? <div className="profile-grid">
          <div className="panel profile-card">
            <p className="eyebrow">YOUR CIVICPULSE PROFILE</p>
            <div className="profile-avatar">{currentUser.displayName.slice(0, 1).toUpperCase()}</div>
            <h1 className="profile-name">{currentUser.displayName}</h1>
            <p className="profile-email">{currentUser.email}</p>
            <button className="secondary-button signout-button" onClick={signOut}>Sign out</button>
          </div>
          <div className="panel score-card-panel">
            <p className="eyebrow">YOUR COMMUNITY CONTRIBUTION</p>
            <h2>Civic Score</h2>
            <p className="score-intro">Every report helps make your neighborhood better.</p>
            <div className="civic-score-value">{profileLoading ? "…" : civicScore?.totalScore ?? 0}<span>PTS</span></div>
            <div className="score-breakdown">
              <div><strong>{profileLoading ? "…" : civicScore?.reportsCount ?? 0}</strong><span>Reports submitted</span></div>
              <div><strong>+{civicScore?.pointsPerReport ?? 10}</strong><span>Points per report</span></div>
            </div>
            <p className="score-explainer">You earn 10 points each time you submit a report successfully. Duplicate warnings that aren’t submitted do not earn points.</p>
            <button className="primary-button" onClick={() => { setPage("home"); setMessage(""); requestAnimationFrame(() => document.getElementById("report")?.scrollIntoView({ behavior: "smooth" })); }}>Make a report <span>↗</span></button>
          </div>
        </div> : <div className="panel auth-panel">
          <p className="eyebrow">{authMode === "register" ? "JOIN YOUR COMMUNITY" : authMode === "forgot" ? "ACCOUNT RECOVERY" : authMode === "reset" ? "SECURE YOUR ACCOUNT" : "WELCOME BACK"}</p>
          <h1 className="auth-title">{authMode === "register" ? "Create your profile." : authMode === "forgot" ? "Forgot your password?" : authMode === "reset" ? "Choose a new password." : "Sign in to CivicPulse."}</h1>
          <p className="auth-intro">{authMode === "forgot"
            ? "Enter the email address on your account. If it exists, we’ll send a secure password reset link."
            : authMode === "reset"
              ? "Choose a new password with at least 10 characters. Reset links expire after one hour."
              : "Sign in to submit reports, track your Civic Score, and see your community contributions add up."}</p>
          <form onSubmit={submitAuth}>
            {authMode === "register" && <label>Your name<input name="displayName" autoComplete="name" value={authForm.displayName} onChange={(event) => setAuthForm((current) => ({ ...current, displayName: event.target.value }))} required minLength="2" maxLength="60" placeholder="How should we address you?" /></label>}
            {authMode !== "reset" && <label>Email address<input name="email" type="email" autoComplete="email" value={authForm.email} onChange={(event) => setAuthForm((current) => ({ ...current, email: event.target.value }))} required maxLength="254" placeholder="you@example.com" /></label>}
            {authMode !== "forgot" && <label>{authMode === "reset" ? "New password" : "Password"}<input name="password" type="password" autoComplete={authMode === "login" ? "current-password" : "new-password"} value={authForm.password} onChange={(event) => setAuthForm((current) => ({ ...current, password: event.target.value }))} required minLength={authMode === "register" || authMode === "reset" ? 10 : 1} maxLength="72" placeholder={authMode === "login" ? "Your password" : "At least 10 characters"} /></label>}
            {authMode === "reset" && <label>Confirm new password<input name="confirmPassword" type="password" autoComplete="new-password" value={authForm.confirmPassword} onChange={(event) => setAuthForm((current) => ({ ...current, confirmPassword: event.target.value }))} required minLength="10" maxLength="72" placeholder="Enter the new password again" /></label>}
            <button className="primary-button auth-submit" type="submit" disabled={authSubmitting}><span>{authSubmitting ? "Please wait..." : authMode === "register" ? "Create account" : authMode === "forgot" ? "Send reset link" : authMode === "reset" ? "Update password" : "Sign in"}</span><span>↗</span></button>
          </form>
          {authMode === "login" && <p className="auth-forgot"><button onClick={() => { setAuthMode("forgot"); setMessage(""); }}>Forgot password?</button></p>}
          <p className="auth-switch">{authMode === "register" ? "Already have an account?" : authMode === "login" ? "New to CivicPulse?" : "Remembered your password?"} <button onClick={() => { setAuthMode(authMode === "register" || authMode === "forgot" || authMode === "reset" ? "login" : "register"); setMessage(""); setAuthForm((current) => ({ ...current, password: "", confirmPassword: "" })); }}>{authMode === "register" || authMode === "forgot" || authMode === "reset" ? "Sign in" : "Create an account"}</button></p>
          {authMode === "register" && <p className="privacy-note">Your password is securely hashed before it is stored. Your sign-in session lasts for this browser tab.</p>}
        </div>}
      </section> : <>
      <section className="hero">
        <div className="hero-copy">
          <p className="hero-kicker">A community noticeboard for local issues</p>
          <h1>See something<br />that needs attention?</h1>
          <p className="hero-text">Report a neighborhood problem, find issues already raised nearby, and follow each report as it moves forward.</p>
          <div className="hero-actions">
            <a className="primary-button hero-button" href="#report">Report an issue <span aria-hidden="true">→</span></a>
            <a className="text-button" href="#community">Browse community reports <span aria-hidden="true">↓</span></a>
          </div>
        </div>
        <div className="hero-note"><span className="hero-note-label">CIVICPULSE</span><p>Local reports, in one shared place.</p><span className="hero-note-rule" /><small>Community issue-reporting project<br />KIET InnoTech 2026</small></div>
      </section>

      <section className="community-stats" aria-label="Community report statistics">
        <div className="community-stats-heading">
          <div><p className="eyebrow">COMMUNITY SNAPSHOT</p><p>Every number reflects reports stored in CivicPulse.</p></div>
          <button className="stats-refresh" onClick={loadIssueSummary} disabled={summaryLoading} aria-label="Refresh community statistics">Refresh</button>
        </div>
        {summaryError && <p className="stats-error" role="status">Statistics are temporarily unavailable. {summaryError}</p>}
        <div className="community-stats-grid">
          <div><strong>{summaryLoading ? "—" : issueSummary?.totalReports ?? "—"}</strong><span>Total reports</span></div>
          <div><strong>{summaryLoading ? "—" : issueSummary?.pendingReports ?? "—"}</strong><span>Need attention</span></div>
          <div><strong>{summaryLoading ? "—" : issueSummary?.resolvedReports ?? "—"}</strong><span>Resolved</span></div>
          <div><strong>{summaryLoading ? "—" : issueSummary?.communitySupports ?? "—"}</strong><span>Community supports</span></div>
        </div>
      </section>

      <section className="homepage-sections">
        <div className="community-panel" id="community">
          <div className="section-heading community-heading">
            <div><p className="eyebrow">THE COMMUNITY NOTICEBOARD</p><h2>Recent reports</h2><p className="feed-intro">Recent community submissions, status updates, and map locations.</p></div>
            <button className="refresh" onClick={() => { loadIssues(); loadIssueSummary(); }} aria-label="Refresh community reports" disabled={loading}>Refresh</button>
          </div>
          <div className="view-tabs" role="tablist" aria-label="Report views">
            <button role="tab" aria-selected={activeView === "feed"} className={activeView === "feed" ? "active" : ""} onClick={() => setActiveView("feed")}>Report feed</button>
            <button role="tab" aria-selected={activeView === "map"} className={activeView === "map" ? "active" : ""} onClick={() => setActiveView("map")}>Issue map <span>{mappedIssues.length}</span></button>
          </div>

          {activeView === "feed" ? <>
            <div className="feed-controls">
              <label className="search-box"><span>⌕</span><input aria-label="Search reports" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search reports" /></label>
              <label className="filter-select"><span className="visually-hidden">Filter by category</span><select aria-label="Filter by category" value={categoryFilter} onChange={(event) => { setCategoryFilter(event.target.value); setShowAllReports(false); }}><option value="All">All categories</option>{CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label>
              <label className="filter-select"><span className="visually-hidden">Filter by status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>{STATUS_FILTERS.map((status) => <option key={status}>{status}</option>)}</select></label>
            </div>
            {loading ? <p className="empty">Gathering community reports...</p> : filteredIssues.length === 0 ? (
              <div className="empty-state"><div className="empty-icon">✳</div><h3>{issues.length ? "No reports match that search" : "A fresh start for this community"}</h3><p>{issues.length ? "Try another keyword or status filter." : "Be the first to report something that needs attention."}</p></div>
            ) : (
              <div className="issue-list">{visibleIssues.map((issue) => {
                const isExpanded = expandedIssue === issue._id;
                return <article className={`issue ${isExpanded ? "expanded" : ""}`} key={issue._id}>
                  <div className={`issue-symbol ${issue.category.toLowerCase().replaceAll(" ", "-")}`}>{issue.category === "Garbage" ? "♻" : issue.category === "Streetlight" ? "☼" : issue.category === "Water" ? "≈" : "⌖"}</div>
                  <div className="issue-main">
                    <div className="issue-title-row"><h3>{issue.title}</h3><span className={`badge ${statusClass(issue.status)}`}>{statusLabel(issue.status)}</span></div>
                    {issue.trackingId && <p className="tracking-line">Tracking ID <strong>{issue.trackingId}</strong></p>}
                    <p className="issue-meta">{issue.category}{issue.location?.address ? ` · ${issue.location.address}` : ""} · {formatDate(issue.createdAt)}</p>
                    {issue.description && <p className="issue-summary">{issue.description}</p>}
                    <div className="issue-bottom"><span className={`priority-pill ${priorityClass(issue.priority)}`}>{issue.priority || "Medium"} priority</span></div>
                    <div className="support-row"><span>{issue.supportCount || 0} {issue.supportCount === 1 ? "neighbor supports" : "neighbors support"} this</span><button type="button" className={`support-button ${supportedIssueIds.includes(issue._id) ? "supported" : ""}`} onClick={() => setIssueSupported(issue._id, !supportedIssueIds.includes(issue._id))} disabled={supportLoadingId === issue._id}>{supportLoadingId === issue._id ? "Updating..." : supportedIssueIds.includes(issue._id) ? "✓ Supported · Remove" : currentUser ? "＋ Support this report" : "Sign in to support"}</button></div>
                    <button className="details-toggle" aria-expanded={isExpanded} onClick={() => toggleIssueDetails(issue._id)}>{isExpanded ? "Hide report details" : "View report details"} <span>{isExpanded ? "↑" : "↓"}</span></button>
                    {isExpanded && <div className="issue-details">
                      {detailLoading === issue._id ? <p>Loading report details...</p> : issueDetails[issue._id] && <>
                        {issueDetails[issue._id].trackingId && <div className="detail-tracking"><span>Tracking ID</span><strong>{issueDetails[issue._id].trackingId}</strong></div>}
                        <p>{issueDetails[issue._id].description}</p>
                        {issueDetails[issue._id].statusHistory?.length > 0
                          ? <div className="timeline"><strong>Status timeline</strong>{issueDetails[issue._id].statusHistory.map((event, index) => <div className="timeline-event" key={`${event.status}-${event.changedAt}-${index}`}><span className="timeline-marker" /><div><span>{timelineLabel(event)}</span><time>{formatDate(event.changedAt)}</time></div></div>)}</div>
                          : <p className="legacy-note">No historical status changes were recorded for this report.</p>}
                        {!issueDetails[issue._id].trackingId && <p className="legacy-note">This older report does not have a tracking ID. Any available status history is shown above.</p>}
                        <div className="score-card"><div className="score-number">{issueDetails[issue._id].priorityScore ?? "—"}<small>/100</small></div><div><strong>Priority score</strong><ul>{(issueDetails[issue._id].priorityReasons || ["Priority explanation is not available for this report."]).map((reason) => <li key={reason}>{reason}</li>)}</ul></div></div>
                        {issueDetails[issue._id].photos?.length > 0 && <div className="issue-photos">{issueDetails[issue._id].photos.map((photo, index) => <a href={photo} target="_blank" rel="noreferrer" key={index}><img src={photo} alt={`Photo attached to ${issue.title}`} loading="lazy" /></a>)}</div>}
                        {Number.isFinite(issueDetails[issue._id].location?.lat) && <a className="map-link" href={`https://www.openstreetmap.org/?mlat=${issueDetails[issue._id].location.lat}&mlon=${issueDetails[issue._id].location.lng}#map=17/${issueDetails[issue._id].location.lat}/${issueDetails[issue._id].location.lng}`} target="_blank" rel="noreferrer">Open report location on map ↗</a>}
                      </>}
                    </div>}
                  </div>
                </article>;
              })}</div>
            )}
            {!loading && filteredIssues.length > 4 && <button className="show-more-reports" type="button" onClick={() => setShowAllReports((current) => !current)}>{showAllReports ? "Show fewer reports" : `View all ${filteredIssues.length} matching reports`}</button>}
          </> : <div className="map-view">
            {mappedIssues.length ? <>
              <div className="map-frame"><iframe title="OpenStreetMap view of reported issue locations" src={mapUrl(mappedIssues)} loading="lazy" /></div>
              <div className="map-summary"><span className="map-summary-icon">⌖</span><span><strong>{mappedIssues.length} mapped reports</strong><small>Map centered on your reported locations</small></span></div>
              <div className="hotspots-heading"><strong>Location clusters</strong><span>Grouped by nearby coordinates</span></div>
              <div className="hotspot-list">{hotspots.slice(0, 5).map((hotspot, index) => <div className="hotspot-row" key={hotspot.key}>
                <span className="hotspot-rank">{String(index + 1).padStart(2, "0")}</span><span className="hotspot-name">{hotspot.issues[0].location.address || `${hotspot.lat.toFixed(3)}, ${hotspot.lng.toFixed(3)}`}<small>{hotspot.issues[0].category}{hotspot.issues.length > 1 ? ` · ${hotspot.issues.length} nearby reports` : ""}</small></span><span className="hotspot-count">{hotspot.issues.length}</span>
              </div>)}</div>
              <a className="map-link map-external-link" href={`https://www.openstreetmap.org/?mlat=${mappedIssues[0].location.lat}&mlon=${mappedIssues[0].location.lng}#map=14/${mappedIssues[0].location.lat}/${mappedIssues[0].location.lng}`} target="_blank" rel="noreferrer">Explore on OpenStreetMap ↗</a>
            </> : <div className="empty-state map-empty"><div className="empty-icon">⌖</div><h3>Your map is waiting for its first pin</h3><p>Reports with location coordinates will show here. Add a location when submitting a report.</p><button className="secondary-button" onClick={() => document.getElementById("report")?.scrollIntoView({ behavior: "smooth" })}>Add the first map pin</button></div>}
          </div>}
          <div className="feed-footer"><span className="live-dot" /> Community reports are public · Location is only shared when added</div>
        </div>

        <aside className="homepage-map-preview">
          <div className="map-preview-heading"><div><p className="eyebrow">ISSUE MAP</p><h2>Reports around the community</h2></div><span>{mappedIssues.length} pins</span></div>
          {loading ? <div className="map-preview-empty"><span aria-hidden="true">⌖</span><p>Loading shared report locations…</p></div> : mappedIssues.length
            ? <div className="map-preview-frame"><iframe title="Preview of community issue locations" src={mapUrl(mappedIssues)} loading="lazy" /></div>
            : <div className="map-preview-empty"><span aria-hidden="true">⌖</span><p>Shared report locations will appear on the map.</p></div>}
          <button type="button" className="map-preview-link" onClick={openCommunityMap}>Explore issue map <span aria-hidden="true">→</span></button>
        </aside>

        <div className="panel form-panel" id="report">
          <div className="section-heading">
            <div><p className="eyebrow">REPORT A LOCAL ISSUE</p><h2>What needs attention?</h2></div>
          </div>
          <p className="form-intro">Give neighbors enough detail to understand and locate the problem. Fields marked required must be completed. {currentUser ? "A submitted report adds 10 points to your Civic Score." : "Sign in to submit a report."}</p>
          <form onSubmit={submitIssue}>
            <label><span>Issue title <span className="required-label">Required</span></span><input name="title" value={form.title} onChange={updateField} required minLength="4" maxLength="120" placeholder="e.g. Large pothole near Gate 1" /></label>
            <div className="form-row">
              <label><span>Category <span className="required-label">Required</span></span><select name="category" value={form.category} onChange={updateField}>{CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label>
              <label><span>Location name <span className="optional-label">Optional</span></span><input name="address" value={form.address} onChange={updateField} maxLength="180" placeholder="Street, landmark, or gate" /></label>
            </div>
            <div className="location-row">
              <div className="coordinates">
                <span>{form.lat && form.lng ? `Coordinates added: ${form.lat}, ${form.lng}` : "Map location optional · share your current coordinates"}</span>
                <button type="button" className="location-button" onClick={captureLocation}>Use my location</button>
              </div>
            </div>
            <label><span>Description <span className="required-label">Required</span></span><textarea name="description" value={form.description} onChange={updateField} required maxLength="2000" rows="5" placeholder="What happened? Include details that might help someone respond..." /></label>
            <div className="photo-field">
              <div className="photo-heading"><span>Photos <small>Optional · up to 4 JPEG, PNG, or WebP images, 1 MB each</small></span><label className="upload-button">Add photos<input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={addPhotos} /></label></div>
              {form.photos.length > 0 && <div className="photo-preview-list">
                {form.photos.map((photo, index) => <div className="photo-preview" key={`${photo.slice(0, 40)}-${index}`}>
                  <img src={photo} alt={`Report attachment ${index + 1}`} />
                  <button type="button" aria-label={`Remove photo ${index + 1}`} onClick={() => setForm((current) => ({ ...current, photos: current.photos.filter((_, photoIndex) => photoIndex !== index) }))}>×</button>
                </div>)}
              </div>}
            </div>
            {duplicate && <div className="duplicate-card">
              <strong>A similar unresolved issue may already be reported.</strong>
              <span>{duplicate.trackingId ? `${duplicate.trackingId} · ` : ""}{duplicate.title} · {statusLabel(duplicate.status)} · {formatDate(duplicate.createdAt)}</span>
              <button type="button" className="details-toggle" onClick={viewDuplicateReport}>View existing report details ↗</button>
              <button type="button" className="secondary-button" disabled={submitting} onClick={() => submitIssue(null, true)}>Submit a separate report anyway</button>
            </div>}
            {currentUser ? <button className="primary-button submit-button" type="submit" disabled={submitting}>
              <span>{submitting ? "Sending report..." : "Submit report"}</span><span aria-hidden="true">→</span>
            </button> : <button className="primary-button submit-button" type="button" onClick={() => { setPage("profile"); setMessage(""); }}>
              <span>Sign in to submit a report</span><span aria-hidden="true">→</span>
            </button>}
          </form>
          <p className="privacy-note">Please avoid including faces, license plates, or other personal information in photos.</p>
        </div>
      </section>

      <section className="about-section" id="about">
        <div><p className="eyebrow">ABOUT CIVICPULSE</p><h2>A community project for clearer local reporting.</h2></div>
        <p>CivicPulse is a community issue-reporting project developed for KIET InnoTech 2026. It helps people share local concerns and follow the status of reports. CivicPulse is not an official government service.</p>
      </section>
      <footer><span>© CivicPulse · KIET InnoTech 2026 · A community project, not an official government service.</span><span>Smarter reporting. Transparent action.</span></footer>
      </>}
    </main>
  );
}
