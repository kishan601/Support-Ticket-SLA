"use client";

import React, { useState, useEffect } from "react";
import { useQuery, useMutation } from "urql";

const DashboardAndTicketsQuery = `
  query GetDashboardAndTickets($status: TicketStatus, $priority: Priority, $slaState: SLAState, $take: Int) {
    dashboard {
      openTickets
      inProgressTickets
      atRiskTickets
      breachedTickets
    }
    tickets(status: $status, priority: $priority, slaState: $slaState, take: $take) {
      nodes {
        id
        title
        description
        priority
        status
        createdAt
        firstResponseAt
        resolvedAt
        reporter {
          id
          name
          email
        }
        assignee {
          id
          name
          email
        }
        sla {
          firstResponseDueAt
          resolutionDueAt
          firstResponseState
          resolutionState
          firstResponseRemainingMinutes
          resolutionRemainingMinutes
        }
        comments {
          id
          content
          createdAt
          author {
            id
            name
            role
          }
        }
      }
    }
    users {
      id
      name
      email
      role
    }
    holidays {
      id
      date
      name
    }
  }
`;

const LoginMutation = `
  mutation Login($email: String!, $password: String!) {
    login(email: $email, password: $password) {
      token
      user {
        id
        name
        email
        role
      }
    }
  }
`;

const RegisterMutation = `
  mutation Register($name: String!, $email: String!, $password: String!, $role: UserRole!) {
    register(name: $name, email: $email, password: $password, role: $role) {
      token
      user {
        id
        name
        email
        role
      }
    }
  }
`;

const CreateTicketMutation = `
  mutation CreateTicket($title: String!, $description: String!, $priority: Priority!) {
    createTicket(title: $title, description: $description, priority: $priority) {
      id
      title
    }
  }
`;

const AddCommentMutation = `
  mutation AddComment($ticketId: ID!, $content: String!) {
    addComment(ticketId: $ticketId, content: $content) {
      id
      content
    }
  }
`;

const AssignTicketMutation = `
  mutation AssignTicket($ticketId: ID!, $assigneeId: ID!) {
    assignTicket(ticketId: $ticketId, assigneeId: $assigneeId) {
      id
      assignee {
        id
        name
      }
    }
  }
`;

const ChangeStatusMutation = `
  mutation ChangeTicketStatus($ticketId: ID!, $status: TicketStatus!) {
    changeTicketStatus(ticketId: $ticketId, status: $status) {
      id
      status
    }
  }
`;

const ResolveTicketMutation = `
  mutation ResolveTicket($ticketId: ID!) {
    resolveTicket(ticketId: $ticketId) {
      id
      status
    }
  }
`;
export interface SLAInfo {
  firstResponseDueAt: string;
  resolutionDueAt: string;
  firstResponseState: "ON_TRACK" | "AT_RISK" | "BREACHED";
  resolutionState: "ON_TRACK" | "AT_RISK" | "BREACHED";
  firstResponseRemainingMinutes: number;
  resolutionRemainingMinutes: number;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: "AGENT" | "REPORTER";
}

export interface Comment {
  id: string;
  content: string;
  createdAt: string;
  author: User;
}

export interface Ticket {
  id: string;
  title: string;
  description: string;
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
  createdAt: string;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  reporter: User;
  assignee: User | null;
  sla: SLAInfo;
  comments: Comment[];
}

export interface Holiday {
  id: string;
  date: string;
  name: string;
}

export interface DashboardData {
  openTickets: number;
  inProgressTickets: number;
  atRiskTickets: number;
  breachedTickets: number;
}

export default function Home() {
  const [authReady, setAuthReady] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [filterPriority, setFilterPriority] = useState<string>("");
  const [filterSlaState, setFilterSlaState] = useState<string>("");
  const [sortBy, setSortBy] = useState<"NEWEST" | "OLDEST" | "PRIORITY" | "SLA_URGENT">("NEWEST");
  const [pageSize, setPageSize] = useState<number>(10);
  
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newPriority, setNewPriority] = useState("HIGH");
  const [newComment, setNewComment] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"LOGIN" | "REGISTER">("LOGIN");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authName, setAuthName] = useState("");
  const [authRole, setAuthRole] = useState<"AGENT" | "REPORTER">("AGENT");
  const [authModalError, setAuthModalError] = useState<string | null>(null);
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const isLoggingInRef = React.useRef(false);
  const hasInitializedRef = React.useRef(false);

  const [, executeLogin] = useMutation(LoginMutation);
  const [, executeRegister] = useMutation(RegisterMutation);
  const [, executeCreateTicket] = useMutation(CreateTicketMutation);
  const [, executeAddComment] = useMutation(AddCommentMutation);
  const [, executeAssignTicket] = useMutation(AssignTicketMutation);
  const [, executeChangeStatus] = useMutation(ChangeStatusMutation);
  const [, executeResolveTicket] = useMutation(ResolveTicketMutation);

  const queryVariables = React.useMemo(() => ({
    status: filterStatus || null,
    priority: filterPriority || null,
    slaState: filterSlaState || null,
    take: pageSize,
  }), [filterStatus, filterPriority, filterSlaState, pageSize]);

  const queryContext = React.useMemo(() => ({
    additionalTypenames: ['Ticket', 'Comment', 'User', 'Dashboard']
  }), []);

  const [{ data, fetching, error }, reexecuteQuery] = useQuery({
    query: DashboardAndTicketsQuery,
    variables: queryVariables,
    pause: !authReady,
    context: queryContext,
  });

  // Auto-login default agent on mount if not logged in
  useEffect(() => {
    if (hasInitializedRef.current) return;
    hasInitializedRef.current = true;

    const initAuth = async () => {
      const savedUser = localStorage.getItem("user");
      const savedToken = localStorage.getItem("token");
      if (savedUser && savedToken) {
        try {
          setCurrentUser(JSON.parse(savedUser));
        } catch {
          localStorage.removeItem("user");
          localStorage.removeItem("token");
        }
        setAuthReady(true);
      } else {
        await quickLogin("agent@example.com", "agent");
        setAuthReady(true);
      }
    };
    initAuth();
  }, []);

  const quickLogin = async (email: string, pass: string) => {
    if (currentUser?.email === email) return;
    if (isLoggingInRef.current) return;
    isLoggingInRef.current = true;
    setActionError(null);
    try {
      const result = await executeLogin({ email, password: pass });
      if (result.data?.login) {
        const { token, user } = result.data.login;
        localStorage.setItem("token", token);
        localStorage.setItem("user", JSON.stringify(user));
        setCurrentUser(user);
      } else if (result.error) {
        setActionError(result.error.message);
      }
    } finally {
      isLoggingInRef.current = false;
    }
  };

  const handleCustomAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthModalError(null);
    setActionError(null);
    setIsAuthSubmitting(true);

    try {
      if (authMode === "LOGIN") {
        const result = await executeLogin({ email: authEmail, password: authPassword });
        if (result.data?.login) {
          const { token, user } = result.data.login;
          localStorage.setItem("token", token);
          localStorage.setItem("user", JSON.stringify(user));
          setCurrentUser(user);
          setIsAuthOpen(false);
          setAuthPassword("");
          setAuthEmail("");
          setAuthModalError(null);
        } else if (result.error) {
          setAuthModalError(result.error.message);
        }
      } else {
        const result = await executeRegister({
          name: authName,
          email: authEmail,
          password: authPassword,
          role: authRole
        });
        if (result.data?.register) {
          const { token, user } = result.data.register;
          localStorage.setItem("token", token);
          localStorage.setItem("user", JSON.stringify(user));
          setCurrentUser(user);
          setIsAuthOpen(false);
          setAuthPassword("");
          setAuthEmail("");
          setAuthName("");
          setAuthModalError(null);
        } else if (result.error) {
          setAuthModalError(result.error.message);
        }
      }
    } finally {
      setIsAuthSubmitting(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setCurrentUser(null);
    reexecuteQuery({ requestPolicy: "network-only" });
  };

  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    if (!newTitle.trim() || !newDesc.trim()) {
      setActionError("Title and description are required.");
      return;
    }
    const res = await executeCreateTicket({ title: newTitle, description: newDesc, priority: newPriority });
    if (res.error) {
      setActionError(res.error.message);
    } else {
      setNewTitle("");
      setNewDesc("");
      setIsCreateOpen(false);
    }
  };

  const handleAddComment = async () => {
    if (!selectedTicket || !newComment.trim()) return;
    setActionError(null);
    const res = await executeAddComment({ ticketId: selectedTicket.id, content: newComment });
    if (res.error) {
      setActionError(res.error.message);
    } else {
      setNewComment("");
    }
  };

  const handleAssign = async (assigneeId: string) => {
    if (!selectedTicket) return;
    setActionError(null);
    const res = await executeAssignTicket({ ticketId: selectedTicket.id, assigneeId });
    if (res.error) {
      setActionError(res.error.message);
    }
  };

  const handleStatusChange = async (status: string) => {
    if (!selectedTicket) return;
    setActionError(null);
    const res = await executeChangeStatus({ ticketId: selectedTicket.id, status });
    if (res.error) {
      setActionError(res.error.message);
    }
  };

  const handleResolve = async () => {
    if (!selectedTicket) return;
    setActionError(null);
    const res = await executeResolveTicket({ ticketId: selectedTicket.id });
    if (res.error) {
      setActionError(res.error.message);
    }
  };

  const dashboard: DashboardData | undefined = data?.dashboard;
  const rawTickets: Ticket[] = data?.tickets?.nodes || [];
  const users: User[] = data?.users || [];
  const holidays: Holiday[] = data?.holidays || [];

  const tickets = React.useMemo(() => {
    const list = [...rawTickets];
    if (sortBy === "NEWEST") {
      return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
    if (sortBy === "OLDEST") {
      return list.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    }
    if (sortBy === "PRIORITY") {
      const weights: Record<string, number> = { URGENT: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
      return list.sort((a, b) => (weights[b.priority] || 0) - (weights[a.priority] || 0));
    }
    if (sortBy === "SLA_URGENT") {
      return list.sort((a, b) => {
        const aMin = Math.min(a.sla?.firstResponseRemainingMinutes ?? 9999, a.sla?.resolutionRemainingMinutes ?? 9999);
        const bMin = Math.min(b.sla?.firstResponseRemainingMinutes ?? 9999, b.sla?.resolutionRemainingMinutes ?? 9999);
        return aMin - bMin;
      });
    }
    return list;
  }, [rawTickets, sortBy]);

  const formatMins = (m: number) => {
    if (m <= 0) return "0m";
    if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
    return `${m}m`;
  };

  // Sync selected ticket updates safely without triggering unnecessary re-renders
  useEffect(() => {
    if (selectedTicket) {
      const updated = tickets.find((t: Ticket) => t.id === selectedTicket.id);
      if (updated && (
        updated.status !== selectedTicket.status ||
        updated.assignee?.id !== selectedTicket.assignee?.id ||
        updated.firstResponseAt !== selectedTicket.firstResponseAt ||
        updated.resolvedAt !== selectedTicket.resolvedAt ||
        (updated.comments?.length || 0) !== (selectedTicket.comments?.length || 0)
      )) {
        setSelectedTicket(updated);
      }
    }
  }, [tickets, selectedTicket]);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 font-sans antialiased flex flex-col">
      {/* Header Bar */}
      <header className="border-b border-neutral-800 bg-neutral-900/60 backdrop-blur sticky top-0 z-30 px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-500 to-emerald-400 flex items-center justify-center font-bold text-black text-sm shadow-md">
            SLA
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Support Ticket & SLA Tracker</h1>
            <p className="text-xs text-neutral-400">Business Hours: Mon–Fri 09:00–18:00 (Asia/Kolkata)</p>
          </div>
        </div>

        {/* User / Role Switcher */}
        <div className="flex items-center gap-4">
          {currentUser ? (
            <div className="flex items-center gap-3 bg-neutral-800/80 border border-neutral-700 px-3 py-1.5 rounded-full text-xs">
              <span className={`px-2 py-0.5 rounded font-semibold text-[10px] ${currentUser.role === 'AGENT' ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30' : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'}`}>
                {currentUser.role}
              </span>
              <span className="text-neutral-300 font-medium">{currentUser.name}</span>
              <button onClick={handleLogout} className="text-neutral-400 hover:text-red-400 ml-1 transition">
                ✕
              </button>
            </div>
          ) : (
            <span className="text-xs text-neutral-400">Not Logged In</span>
          )}

          <div className="flex items-center gap-2 border-l border-neutral-800 pl-4">
            <span className="text-xs text-neutral-500">Switch:</span>
            <button
              onClick={() => quickLogin("agent@example.com", "agent")}
              disabled={currentUser?.email === "agent@example.com"}
              className={`text-xs px-2.5 py-1 rounded transition ${
                currentUser?.email === "agent@example.com"
                  ? "bg-indigo-600/40 text-indigo-200 border border-indigo-400 font-semibold cursor-default"
                  : "bg-indigo-600/20 text-indigo-300 border border-indigo-500/40 hover:bg-indigo-600/30"
              }`}
            >
              Agent
            </button>
            <button
              onClick={() => quickLogin("reporter@example.com", "reporter")}
              disabled={currentUser?.email === "reporter@example.com"}
              className={`text-xs px-2.5 py-1 rounded transition ${
                currentUser?.email === "reporter@example.com"
                  ? "bg-emerald-600/40 text-emerald-200 border border-emerald-400 font-semibold cursor-default"
                  : "bg-emerald-600/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-600/30"
              }`}
            >
              Reporter
            </button>
            <button
              onClick={() => { setIsAuthOpen(true); setActionError(null); }}
              className="text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700 px-2.5 py-1 rounded transition"
            >
              Custom Login / Sign Up
            </button>
          </div>

          <button
            onClick={() => { setIsCreateOpen(true); setActionError(null); }}
            className="bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-medium text-xs px-3.5 py-1.5 rounded-lg shadow transition flex items-center gap-1.5 ml-2"
          >
            <span>+</span> Raise Ticket
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-8 space-y-8">
        {/* Error Alert */}
        {actionError && (
          <div className="bg-red-950/60 border border-red-800 text-red-300 px-4 py-3 rounded-xl flex items-center justify-between text-sm shadow-lg">
            <div className="flex items-center gap-2">
              <span className="font-bold">Error:</span> {actionError}
            </div>
            <button onClick={() => setActionError(null)} className="text-red-400 hover:text-red-200">✕</button>
          </div>
        )}

        {/* Dashboard Metrics */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-neutral-900/80 border border-neutral-800 p-5 rounded-2xl shadow">
            <div className="text-neutral-400 text-xs font-semibold uppercase tracking-wider mb-2">Open Tickets</div>
            <div className="text-3xl font-light">{dashboard?.openTickets ?? 0}</div>
          </div>
          <div className="bg-neutral-900/80 border border-neutral-800 p-5 rounded-2xl shadow">
            <div className="text-neutral-400 text-xs font-semibold uppercase tracking-wider mb-2">In Progress</div>
            <div className="text-3xl font-light text-blue-400">{dashboard?.inProgressTickets ?? 0}</div>
          </div>
          <div className="bg-neutral-900/80 border border-neutral-800 p-5 rounded-2xl shadow">
            <div className="text-amber-400 text-xs font-semibold uppercase tracking-wider mb-2">At Risk (&gt;75% SLA)</div>
            <div className="text-3xl font-light text-amber-400">{dashboard?.atRiskTickets ?? 0}</div>
          </div>
          <div className="bg-neutral-900/80 border border-neutral-800 p-5 rounded-2xl shadow">
            <div className="text-red-400 text-xs font-semibold uppercase tracking-wider mb-2">Breached SLA</div>
            <div className="text-3xl font-light text-red-400">{dashboard?.breachedTickets ?? 0}</div>
          </div>
        </section>

        {/* Holidays & Business Rules Info Box */}
        <section className="bg-neutral-900/40 border border-neutral-800/80 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-2 text-neutral-300">
            <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block animate-pulse"></span>
            <span><strong>Configured Holidays:</strong> {holidays.map((h: Holiday) => `${h.name} (${h.date})`).join(", ") || "None"}</span>
          </div>
          <div className="text-neutral-500">
            SLA policy: URGENT (1h/4h) | HIGH (4h/24h) | MEDIUM (8h/48h) | LOW (24h/72h)
          </div>
        </section>

        {/* Filter & Sort Controls */}
        <section className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs text-neutral-400 font-medium">Filter:</span>
            
            {/* Status Filter */}
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="bg-neutral-900 border border-neutral-800 text-xs rounded-lg px-3 py-1.5 text-neutral-300 focus:outline-none focus:border-indigo-500"
            >
              <option value="">All Statuses</option>
              <option value="OPEN">Open</option>
              <option value="IN_PROGRESS">In Progress</option>
              <option value="RESOLVED">Resolved</option>
              <option value="CLOSED">Closed</option>
            </select>

            {/* Priority Filter */}
            <select
              value={filterPriority}
              onChange={(e) => setFilterPriority(e.target.value)}
              className="bg-neutral-900 border border-neutral-800 text-xs rounded-lg px-3 py-1.5 text-neutral-300 focus:outline-none focus:border-indigo-500"
            >
              <option value="">All Priorities</option>
              <option value="URGENT">Urgent</option>
              <option value="HIGH">High</option>
              <option value="MEDIUM">Medium</option>
              <option value="LOW">Low</option>
            </select>

            {/* SLA State Filter */}
            <select
              value={filterSlaState}
              onChange={(e) => setFilterSlaState(e.target.value)}
              className="bg-neutral-900 border border-neutral-800 text-xs rounded-lg px-3 py-1.5 text-neutral-300 focus:outline-none focus:border-indigo-500"
            >
              <option value="">All SLA States</option>
              <option value="ON_TRACK">On Track</option>
              <option value="AT_RISK">At Risk</option>
              <option value="BREACHED">Breached</option>
            </select>

            {/* Sort Control */}
            <div className="flex items-center gap-1.5 border-l border-neutral-800 pl-3">
              <span className="text-xs text-neutral-400 font-medium">Sort:</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as "NEWEST" | "OLDEST" | "PRIORITY" | "SLA_URGENT")}
                className="bg-neutral-900 border border-neutral-800 text-xs rounded-lg px-3 py-1.5 text-neutral-300 focus:outline-none focus:border-indigo-500"
              >
                <option value="NEWEST">Newest First</option>
                <option value="OLDEST">Oldest First</option>
                <option value="PRIORITY">Priority (Highest)</option>
                <option value="SLA_URGENT">SLA Urgency</option>
              </select>
            </div>

            {/* Limit Control */}
            <div className="flex items-center gap-1.5 border-l border-neutral-800 pl-3">
              <span className="text-xs text-neutral-400 font-medium">Limit:</span>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="bg-neutral-900 border border-neutral-800 text-xs rounded-lg px-2.5 py-1.5 text-neutral-300 focus:outline-none focus:border-indigo-500"
              >
                <option value={5}>5</option>
                <option value={10}>10</option>
                <option value={15}>15</option>
                <option value={25}>25</option>
              </select>
            </div>

            {(filterStatus || filterPriority || filterSlaState) && (
              <button
                onClick={() => { setFilterStatus(""); setFilterPriority(""); setFilterSlaState(""); }}
                className="text-xs text-neutral-500 hover:text-neutral-300 underline ml-1"
              >
                Clear
              </button>
            )}
          </div>

          <div className="text-xs text-neutral-500">
            Showing {tickets.length} tickets (Limit: {pageSize})
          </div>
        </section>

        {/* Tickets Table with Inner Scrollbar */}
        <section className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden shadow-2xl">
          {fetching && !data ? (
            <div className="p-12 text-center text-neutral-400 text-sm">Loading tickets...</div>
          ) : (
            <div className="max-h-[480px] overflow-y-auto overflow-x-auto custom-scrollbar">
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 z-10 bg-neutral-900/95 backdrop-blur border-b border-neutral-800 shadow-sm">
                  <tr className="text-neutral-400 text-xs">
                    <th className="px-6 py-3.5 font-medium uppercase tracking-wider w-20">ID</th>
                    <th className="px-6 py-3.5 font-medium uppercase tracking-wider">Title</th>
                    <th className="px-6 py-3.5 font-medium uppercase tracking-wider w-28">Priority</th>
                    <th className="px-6 py-3.5 font-medium uppercase tracking-wider w-32">Status</th>
                    <th className="px-6 py-3.5 font-medium uppercase tracking-wider w-40">Assignee</th>
                    <th className="px-6 py-3.5 font-medium uppercase tracking-wider text-right w-44">Response SLA</th>
                    <th className="px-6 py-3.5 font-medium uppercase tracking-wider text-right w-44">Resolution SLA</th>
                  </tr>
                </thead>
              <tbody className="divide-y divide-neutral-800/60 text-sm">
                {tickets.map((t: Ticket) => {
                  const frSla = t.sla;
                  const isResolved = t.status === "RESOLVED" || t.status === "CLOSED";
                  const isFirstResponded = !!t.firstResponseAt;

                  const getSlaBadge = (state: string, mins: number, frozen: boolean) => {
                    if (frozen) {
                      return <span className="text-xs text-emerald-400 font-medium bg-emerald-500/10 px-2 py-0.5 rounded">Met</span>;
                    }
                    if (state === "BREACHED") {
                      return <span className="text-xs text-red-400 font-medium bg-red-500/10 px-2 py-0.5 rounded">Breached</span>;
                    }
                    if (state === "AT_RISK") {
                      return <span className="text-xs text-amber-400 font-medium bg-amber-500/10 px-2 py-0.5 rounded">{formatMins(mins)} rem</span>;
                    }
                    return <span className="text-xs text-neutral-300 font-medium bg-neutral-800 px-2 py-0.5 rounded">{formatMins(mins)}</span>;
                  };

                  return (
                    <tr
                      key={t.id}
                      onClick={() => setSelectedTicket(t)}
                      className="hover:bg-neutral-800/40 transition-colors cursor-pointer group"
                    >
                      <td className="px-6 py-4 font-mono text-xs text-neutral-500 group-hover:text-neutral-300">
                        #{t.id.slice(0, 5)}
                      </td>
                      <td className="px-6 py-4 text-neutral-200 font-medium group-hover:text-white">
                        {t.title}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`text-xs font-semibold tracking-wider px-2 py-0.5 rounded ${
                          t.priority === 'URGENT' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
                          t.priority === 'HIGH' ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30' :
                          t.priority === 'MEDIUM' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' :
                          'bg-neutral-800 text-neutral-400'
                        }`}>
                          {t.priority}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-xs font-medium text-neutral-300">
                        {t.status.replace("_", " ")}
                      </td>
                      <td className="px-6 py-4 text-xs text-neutral-400">
                        {t.assignee ? t.assignee.name : <span className="text-neutral-600 italic">Unassigned</span>}
                      </td>
                      <td className="px-6 py-4 text-right">
                        {getSlaBadge(frSla.firstResponseState, frSla.firstResponseRemainingMinutes, isFirstResponded)}
                      </td>
                      <td className="px-6 py-4 text-right">
                        {getSlaBadge(frSla.resolutionState, frSla.resolutionRemainingMinutes, isResolved)}
                      </td>
                    </tr>
                  );
                })}
                {tickets.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-neutral-500 text-sm">
                      No tickets matching the filter criteria.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            </div>
          )}
        </section>
      </main>

      {/* Ticket Details Drawer / Modal */}
      {selectedTicket && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex justify-end">
          <div className="w-full max-w-xl bg-neutral-900 border-l border-neutral-800 h-full overflow-y-auto p-6 flex flex-col justify-between space-y-6 shadow-2xl">
            <div className="space-y-6">
              {/* Header */}
              <div className="flex items-start justify-between border-b border-neutral-800 pb-4">
                <div>
                  <span className="font-mono text-xs text-neutral-500">#{selectedTicket.id}</span>
                  <h2 className="text-xl font-bold text-white mt-1">{selectedTicket.title}</h2>
                  <p className="text-xs text-neutral-400 mt-1">
                    Reported by <span className="text-neutral-200 font-medium">{selectedTicket.reporter?.name}</span> ({selectedTicket.reporter?.email})
                  </p>
                </div>
                <button
                  onClick={() => setSelectedTicket(null)}
                  className="text-neutral-400 hover:text-white text-lg p-1"
                >
                  ✕
                </button>
              </div>

              {/* Description */}
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-1">Description</h4>
                <p className="text-sm text-neutral-300 bg-neutral-950/60 p-3 rounded-xl border border-neutral-800 whitespace-pre-wrap">
                  {selectedTicket.description}
                </p>
              </div>

              {/* SLA Clocks Breakdown */}
              <div className="grid grid-cols-2 gap-3 bg-neutral-950/80 p-4 rounded-xl border border-neutral-800 text-xs">
                <div>
                  <span className="text-neutral-500 block mb-1">First Response SLA:</span>
                  <span className="font-semibold text-neutral-200" suppressHydrationWarning>
                    {selectedTicket.firstResponseAt ? (
                      <span className="text-emerald-400">✓ Responded at {new Date(selectedTicket.firstResponseAt).toLocaleTimeString()}</span>
                    ) : (
                      <span>Due {new Date(selectedTicket.sla.firstResponseDueAt).toLocaleString()} ({formatMins(selectedTicket.sla.firstResponseRemainingMinutes)} remaining)</span>
                    )}
                  </span>
                </div>
                <div>
                  <span className="text-neutral-500 block mb-1">Resolution SLA:</span>
                  <span className="font-semibold text-neutral-200" suppressHydrationWarning>
                    {selectedTicket.resolvedAt ? (
                      <span className="text-emerald-400">✓ Resolved at {new Date(selectedTicket.resolvedAt).toLocaleTimeString()}</span>
                    ) : (
                      <span>Due {new Date(selectedTicket.sla.resolutionDueAt).toLocaleString()} ({formatMins(selectedTicket.sla.resolutionRemainingMinutes)} remaining)</span>
                    )}
                  </span>
                </div>
              </div>

              {/* Agent Actions (Assign, Status, Resolve) */}
              <div className="space-y-3 bg-neutral-800/40 p-4 rounded-xl border border-neutral-800">
                <div className="text-xs font-semibold uppercase tracking-wider text-neutral-400 flex items-center justify-between">
                  <span>Agent Actions</span>
                  {currentUser?.role !== 'AGENT' && (
                    <span className="text-[10px] text-amber-500">Requires Agent Role</span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] text-neutral-400 block mb-1">Assignee</label>
                    <select
                      value={selectedTicket.assignee?.id || ""}
                      onChange={(e) => handleAssign(e.target.value)}
                      disabled={currentUser?.role !== 'AGENT'}
                      className="w-full bg-neutral-900 border border-neutral-700 text-xs rounded-lg px-2.5 py-1.5 text-neutral-200 disabled:opacity-50"
                    >
                      <option value="">Unassigned</option>
                      {users.map((u: User) => (
                        <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-[11px] text-neutral-400 block mb-1">
                      Status {selectedTicket.status === 'CLOSED' && <span className="text-[10px] text-neutral-500 font-normal">(Finalized)</span>}
                    </label>
                    <select
                      value={selectedTicket.status}
                      onChange={(e) => handleStatusChange(e.target.value)}
                      disabled={currentUser?.role !== 'AGENT' || selectedTicket.status === 'CLOSED'}
                      className="w-full bg-neutral-900 border border-neutral-700 text-xs rounded-lg px-2.5 py-1.5 text-neutral-200 disabled:opacity-50"
                    >
                      {selectedTicket.status === 'OPEN' && (
                        <>
                          <option value="OPEN">Open (Current)</option>
                          <option value="IN_PROGRESS">In Progress</option>
                          <option value="RESOLVED">Resolved</option>
                          <option value="CLOSED">Closed</option>
                        </>
                      )}
                      {selectedTicket.status === 'IN_PROGRESS' && (
                        <>
                          <option value="IN_PROGRESS">In Progress (Current)</option>
                          <option value="RESOLVED">Resolved</option>
                          <option value="CLOSED">Closed</option>
                        </>
                      )}
                      {selectedTicket.status === 'RESOLVED' && (
                        <>
                          <option value="RESOLVED">Resolved (Current)</option>
                          <option value="IN_PROGRESS">In Progress (Re-open)</option>
                          <option value="CLOSED">Closed</option>
                        </>
                      )}
                      {selectedTicket.status === 'CLOSED' && (
                        <option value="CLOSED">Closed (Terminal State)</option>
                      )}
                    </select>
                  </div>
                </div>

                {selectedTicket.status !== 'RESOLVED' && selectedTicket.status !== 'CLOSED' && (
                  <button
                    onClick={handleResolve}
                    disabled={currentUser?.role !== 'AGENT'}
                    className="w-full mt-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold py-2 rounded-lg transition"
                  >
                    ✓ Mark as Resolved
                  </button>
                )}
              </div>

              {/* Comments Section */}
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-3">
                  Discussion Thread ({selectedTicket.comments?.length || 0})
                </h4>

                <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
                  {selectedTicket.comments?.map((c: Comment) => (
                    <div key={c.id} className="bg-neutral-950/60 p-3 rounded-xl border border-neutral-800/80 text-xs space-y-1">
                      <div className="flex items-center justify-between text-neutral-400">
                        <span className="font-semibold text-neutral-200">{c.author?.name} ({c.author?.role})</span>
                        <span className="text-[10px] text-neutral-500" suppressHydrationWarning>{new Date(c.createdAt).toLocaleTimeString()}</span>
                      </div>
                      <p className="text-neutral-300">{c.content}</p>
                    </div>
                  ))}
                  {(!selectedTicket.comments || selectedTicket.comments.length === 0) && (
                    <p className="text-xs text-neutral-500 italic">No comments yet.</p>
                  )}
                </div>

                {/* Add Comment Input */}
                <div className="mt-4 flex gap-2">
                  <input
                    type="text"
                    placeholder={currentUser?.role === 'AGENT' ? "Write reply (counts as first response)..." : "Add comment..."}
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddComment()}
                    className="flex-1 bg-neutral-950 border border-neutral-800 text-xs rounded-xl px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                  />
                  <button
                    onClick={handleAddComment}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium px-4 py-2 rounded-xl transition"
                  >
                    Send
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Ticket Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-neutral-900 border border-neutral-800 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
              <h3 className="text-lg font-bold text-white">Create New Support Ticket</h3>
              <button onClick={() => setIsCreateOpen(false)} className="text-neutral-400 hover:text-white">✕</button>
            </div>

            <form onSubmit={handleCreateTicket} className="space-y-4 text-xs">
              <div>
                <label className="block text-neutral-400 mb-1">Ticket Title</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Payment gateway timeout on checkout"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-neutral-400 mb-1">Priority (affects SLA deadlines)</label>
                <select
                  value={newPriority}
                  onChange={(e) => setNewPriority(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                >
                  <option value="URGENT">URGENT (1h First Response, 4h Resolution)</option>
                  <option value="HIGH">HIGH (4h First Response, 24h Resolution)</option>
                  <option value="MEDIUM">MEDIUM (8h First Response, 48h Resolution)</option>
                  <option value="LOW">LOW (24h First Response, 72h Resolution)</option>
                </select>
              </div>

              <div>
                <label className="block text-neutral-400 mb-1">Description</label>
                <textarea
                  rows={4}
                  required
                  placeholder="Provide detailed steps or context..."
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                ></textarea>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-neutral-800">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="px-4 py-2 bg-neutral-800 text-neutral-300 rounded-xl hover:bg-neutral-700 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-semibold rounded-xl transition"
                >
                  Submit Ticket
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Custom Auth Modal (Login / Sign Up) */}
      {isAuthOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-neutral-900 border border-neutral-800 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setAuthMode("LOGIN")}
                  className={`text-sm font-semibold pb-1 border-b-2 transition ${authMode === "LOGIN" ? "text-white border-indigo-500" : "text-neutral-400 border-transparent hover:text-neutral-200"}`}
                >
                  Sign In
                </button>
                <button
                  onClick={() => setAuthMode("REGISTER")}
                  className={`text-sm font-semibold pb-1 border-b-2 transition ${authMode === "REGISTER" ? "text-white border-emerald-500" : "text-neutral-400 border-transparent hover:text-neutral-200"}`}
                >
                  Create Account
                </button>
              </div>
              <button 
                onClick={() => { setIsAuthOpen(false); setAuthModalError(null); }} 
                className="text-neutral-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            {authModalError && (
              <div className="bg-red-950/70 border border-red-800 text-red-300 px-3 py-2 rounded-xl text-xs flex items-center justify-between">
                <span>{authModalError}</span>
                <button 
                  type="button" 
                  onClick={() => setAuthModalError(null)} 
                  className="text-red-400 hover:text-red-200 ml-2"
                >
                  ✕
                </button>
              </div>
            )}

            <form onSubmit={handleCustomAuth} className="space-y-4 text-xs">
              {authMode === "REGISTER" && (
                <div>
                  <label className="block text-neutral-400 mb-1">Full Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Jane Doe"
                    value={authName}
                    onChange={(e) => setAuthName(e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              )}

              <div>
                <label className="block text-neutral-400 mb-1">Email Address</label>
                <input
                  type="email"
                  required
                  placeholder="name@company.com"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-neutral-400 mb-1">Password</label>
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              {authMode === "REGISTER" && (
                <div>
                  <label className="block text-neutral-400 mb-1">Account Role</label>
                  <select
                    value={authRole}
                    onChange={(e) => setAuthRole(e.target.value as "AGENT" | "REPORTER")}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                  >
                    <option value="AGENT">AGENT (Can assign, reply, & resolve tickets)</option>
                    <option value="REPORTER">REPORTER (Can create & track tickets)</option>
                  </select>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-neutral-800">
                <button
                  type="button"
                  onClick={() => { setIsAuthOpen(false); setAuthModalError(null); }}
                  className="px-4 py-2 bg-neutral-800 text-neutral-300 rounded-xl hover:bg-neutral-700 transition"
                  disabled={isAuthSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isAuthSubmitting}
                  className={`px-4 py-2 text-neutral-950 font-semibold rounded-xl transition ${authMode === "LOGIN" ? "bg-indigo-500 hover:bg-indigo-400 text-white" : "bg-emerald-500 hover:bg-emerald-400"} ${isAuthSubmitting ? "opacity-60 cursor-not-allowed" : ""}`}
                >
                  {isAuthSubmitting 
                    ? (authMode === "LOGIN" ? "Signing In..." : "Creating Account...") 
                    : (authMode === "LOGIN" ? "Sign In" : "Register")
                  }
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
