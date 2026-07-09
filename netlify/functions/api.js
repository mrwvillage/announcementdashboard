import { getStore } from "@netlify/blobs";

const LIST_KEY = "list";

function nextSunday() {
  const d = new Date();
  const daysAhead = (7 - d.getDay()) % 7;
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

function upcomingSundays(count = 12) {
  const first = new Date(nextSunday());
  const dates = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(first);
    d.setDate(d.getDate() + i * 7);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

function upcomingMonths(count = 6) {
  const d = new Date();
  const months = [];
  for (let i = 1; i <= count; i++) {
    const y = d.getFullYear() + Math.floor((d.getMonth() + i) / 12);
    const m = ((d.getMonth() + i) % 12) + 1;
    months.push(`${y}-${String(m).padStart(2, "0")}`);
  }
  return months;
}

function genId() {
  return Math.random().toString(36).slice(2, 12);
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default async (req) => {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;
  const store = getStore(LIST_KEY);

  if (path === "/api/next-sunday" && method === "GET") {
    return json(200, { date: nextSunday() });
  }

  if (path === "/api/upcoming-sundays" && method === "GET") {
    return json(200, { dates: upcomingSundays() });
  }

  if (path === "/api/upcoming-months" && method === "GET") {
    return json(200, { months: upcomingMonths() });
  }

  if (path === "/api/announcements" && method === "GET") {
    const items = (await store.get(LIST_KEY, { type: "json" })) || [];
    const serviceDate = url.searchParams.get("serviceDate");
    const newsletterMonth = url.searchParams.get("newsletterMonth");
    let filtered = items;
    if (serviceDate) filtered = filtered.filter((a) => a.serviceDate === serviceDate);
    if (newsletterMonth) filtered = filtered.filter((a) => a.newsletterMonth === newsletterMonth);
    filtered.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return json(200, filtered);
  }

  if (path === "/api/announcements" && method === "POST") {
    let data;
    try {
      data = await req.json();
    } catch {
      return json(400, { error: "Invalid JSON" });
    }

    const title = (data.title || "").trim();
    const submittedBy = (data.submittedBy || "").trim();
    const channel = data.channel;
    let serviceDate = data.serviceDate;
    let newsletterMonth = data.newsletterMonth;

    if (!title) return json(400, { error: "Title is required" });
    if (!submittedBy) return json(400, { error: "Your name is required" });
    if (!["announce", "bulletin", "both", "newsletter"].includes(channel)) {
      return json(400, { error: "Invalid channel" });
    }
    if (channel === "newsletter") {
      if (!newsletterMonth) return json(400, { error: "Newsletter month is required" });
      serviceDate = null;
    } else {
      if (!serviceDate) return json(400, { error: "Service date is required" });
      newsletterMonth = null;
    }

    const items = (await store.get(LIST_KEY, { type: "json" })) || [];
    const entry = {
      id: genId(),
      title,
      description: (data.description || "").trim(),
      serviceDate,
      newsletterMonth,
      submittedBy,
      channel,
      createdAt: new Date().toISOString(),
      done: false,
    };
    items.push(entry);
    await store.setJSON(LIST_KEY, items);
    return json(201, entry);
  }

  const idMatch = path.match(/^\/api\/announcements\/([\w-]+)$/);

  if (idMatch && method === "PATCH") {
    let data;
    try {
      data = await req.json();
    } catch {
      return json(400, { error: "Invalid JSON" });
    }
    const id = idMatch[1];
    const items = (await store.get(LIST_KEY, { type: "json" })) || [];
    const idx = items.findIndex((a) => a.id === id);
    if (idx === -1) return json(404, { error: "Not found" });
    items[idx] = { ...items[idx], ...data, id };
    await store.setJSON(LIST_KEY, items);
    return json(200, items[idx]);
  }

  if (idMatch && method === "DELETE") {
    const id = idMatch[1];
    const items = (await store.get(LIST_KEY, { type: "json" })) || [];
    const next = items.filter((a) => a.id !== id);
    await store.setJSON(LIST_KEY, next);
    return json(200, { ok: true });
  }

  return json(404, { error: "Not found" });
};

export const config = { path: "/api/*" };
