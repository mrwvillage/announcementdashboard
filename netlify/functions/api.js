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

  if (path === "/api/announcements" && method === "GET") {
    const items = (await store.get(LIST_KEY, { type: "json" })) || [];
    const serviceDate = url.searchParams.get("serviceDate");
    const filtered = serviceDate
      ? items.filter((a) => a.serviceDate === serviceDate)
      : items;
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
    const serviceDate = data.serviceDate;
    const channel = data.channel;

    if (!title) return json(400, { error: "Title is required" });
    if (!serviceDate) return json(400, { error: "Service date is required" });
    if (!["announce", "bulletin", "both"].includes(channel)) {
      return json(400, { error: "Invalid channel" });
    }

    const items = (await store.get(LIST_KEY, { type: "json" })) || [];
    const entry = {
      id: genId(),
      title,
      description: (data.description || "").trim(),
      serviceDate,
      submittedBy: (data.submittedBy || "").trim(),
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
