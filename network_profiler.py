#!/usr/bin/env python3
"""
Network Profiler — continuous monitoring with live HTML dashboard.

Tracks latency, packet loss, jitter, DNS resolution, throughput,
and disconnection events.  Runs a FastAPI server with WebSocket push
so the dashboard updates in real time.  On shutdown a static HTML
snapshot is saved for offline review.

Usage:
    python3 network_profiler.py                      # run until Ctrl-C
    python3 network_profiler.py --duration 30m       # run for 30 minutes
    python3 network_profiler.py --duration 2h        # run for 2 hours
    python3 network_profiler.py --interval 1         # ping every 1 s
    python3 network_profiler.py --output my_report.html
    python3 network_profiler.py --targets 1.1.1.1 8.8.8.8 google.com
    python3 network_profiler.py --port 8050          # custom port

Press Ctrl-C to stop early.  The HTML file and SQLite DB are always
kept on disk, so nothing is lost if the script is interrupted.
"""

import argparse
import asyncio
import json
import mimetypes
import os
import re
import signal
import socket
import sqlite3
import statistics
import subprocess
import sys
import textwrap
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from html import escape

import psutil
import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse, Response

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
DEFAULT_INTERVAL = 2          # seconds between measurement rounds
DEFAULT_REPORT_INTERVAL = 5   # seconds between data recomputation
DEFAULT_DURATION = None       # None = run until Ctrl-C
DEFAULT_PORT = 8065
DEFAULT_HTML = "network_profile.html"
DEFAULT_DB = "network_profile.db"
DEFAULT_DNS_DOMAINS = [
    "google.com", "github.com", "cloudflare.com",
    "claude.ai", "cloudflare.com",
]

COLORS = [
    "#3b82f6", "#ef4444", "#22c55e", "#f59e0b",
    "#8b5cf6", "#ec4899", "#14b8a6", "#f97316",
]

_script_dir = os.path.dirname(os.path.abspath(__file__))

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def parse_duration(s: str) -> float:
    """Parse a human duration string like '30s', '10m', '2h', '1.5h' into seconds."""
    s = s.strip().lower()
    m = re.fullmatch(r"([\d.]+)\s*(s|sec|seconds?|m|min|minutes?|h|hr|hours?)?", s)
    if not m:
        raise ValueError(f"Cannot parse duration: {s!r}  (examples: 30s, 10m, 2h)")
    val = float(m.group(1))
    unit = (m.group(2) or "s")[0]
    multiplier = {"s": 1, "m": 60, "h": 3600}[unit]
    return val * multiplier


def get_default_gateway() -> str | None:
    """Return the default gateway IP, or None."""
    try:
        out = subprocess.check_output(
            ["ip", "route", "show", "default"],
            text=True, timeout=5,
        )
        m = re.search(r"via\s+(\S+)", out)
        return m.group(1) if m else None
    except Exception:
        return None


def ping_host(host: str, count: int = 1, timeout: int = 3) -> dict:
    """
    Ping *host* and return a dict with keys:
        host, timestamp, latency_ms (float|None), lost (bool)
    """
    ts = datetime.now(timezone.utc).isoformat()
    try:
        out = subprocess.run(
            ["ping", "-c", str(count), "-W", str(timeout), host],
            capture_output=True, text=True, timeout=timeout + 2,
        )
        m = re.search(r"time[=<]([\d.]+)\s*ms", out.stdout)
        if m:
            return {"host": host, "timestamp": ts,
                    "latency_ms": float(m.group(1)), "lost": False}
        return {"host": host, "timestamp": ts,
                "latency_ms": None, "lost": True}
    except Exception:
        return {"host": host, "timestamp": ts,
                "latency_ms": None, "lost": True}


def measure_dns(domain: str, server: str | None = None) -> dict:
    """Measure DNS resolution time for *domain*.  Returns dict."""
    ts = datetime.now(timezone.utc).isoformat()
    start = time.monotonic()
    try:
        socket.getaddrinfo(domain, 80, socket.AF_INET)
        elapsed = (time.monotonic() - start) * 1000
        return {"domain": domain, "timestamp": ts,
                "resolve_ms": round(elapsed, 2), "failed": False}
    except Exception:
        elapsed = (time.monotonic() - start) * 1000
        return {"domain": domain, "timestamp": ts,
                "resolve_ms": round(elapsed, 2), "failed": True}


def get_throughput_snapshot() -> dict:
    """Return current psutil net counters."""
    c = psutil.net_io_counters()
    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "bytes_sent": c.bytes_sent,
        "bytes_recv": c.bytes_recv,
        "packets_sent": c.packets_sent,
        "packets_recv": c.packets_recv,
        "errin": c.errin,
        "errout": c.errout,
        "dropin": c.dropin,
        "dropout": c.dropout,
    }

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

def init_db(path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(textwrap.dedent("""\
        CREATE TABLE IF NOT EXISTS pings (
            id        INTEGER PRIMARY KEY,
            ts        TEXT NOT NULL,
            host      TEXT NOT NULL,
            latency   REAL,
            lost      INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS dns (
            id        INTEGER PRIMARY KEY,
            ts        TEXT NOT NULL,
            domain    TEXT NOT NULL,
            resolve   REAL,
            failed    INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS throughput (
            id           INTEGER PRIMARY KEY,
            ts           TEXT NOT NULL,
            bytes_sent   INTEGER,
            bytes_recv   INTEGER,
            packets_sent INTEGER,
            packets_recv INTEGER,
            errin        INTEGER,
            errout       INTEGER,
            dropin       INTEGER,
            dropout      INTEGER
        );
        CREATE TABLE IF NOT EXISTS events (
            id   INTEGER PRIMARY KEY,
            ts   TEXT NOT NULL,
            kind TEXT NOT NULL,
            detail TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_pings_ts ON pings(ts);
        CREATE INDEX IF NOT EXISTS idx_dns_ts   ON dns(ts);
        CREATE INDEX IF NOT EXISTS idx_tp_ts    ON throughput(ts);
    """))
    conn.commit()
    return conn


DB_LOCK = threading.Lock()


def db_insert_ping(conn, p):
    with DB_LOCK:
        conn.execute(
            "INSERT INTO pings(ts,host,latency,lost) VALUES(?,?,?,?)",
            (p["timestamp"], p["host"], p["latency_ms"], int(p["lost"])),
        )
        conn.commit()


def db_insert_dns(conn, d):
    with DB_LOCK:
        conn.execute(
            "INSERT INTO dns(ts,domain,resolve,failed) VALUES(?,?,?,?)",
            (d["timestamp"], d["domain"], d["resolve_ms"], int(d["failed"])),
        )
        conn.commit()


def db_insert_throughput(conn, t):
    with DB_LOCK:
        conn.execute(
            "INSERT INTO throughput(ts,bytes_sent,bytes_recv,"
            "packets_sent,packets_recv,errin,errout,dropin,dropout) "
            "VALUES(?,?,?,?,?,?,?,?,?)",
            (t["timestamp"], t["bytes_sent"], t["bytes_recv"],
             t["packets_sent"], t["packets_recv"],
             t["errin"], t["errout"], t["dropin"], t["dropout"]),
        )
        conn.commit()


def db_insert_event(conn, kind, detail=""):
    ts = datetime.now(timezone.utc).isoformat()
    with DB_LOCK:
        conn.execute(
            "INSERT INTO events(ts,kind,detail) VALUES(?,?,?)",
            (ts, kind, detail),
        )
        conn.commit()

# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def load_pings(conn) -> list[dict]:
    with DB_LOCK:
        rows = conn.execute(
            "SELECT ts, host, latency, lost FROM pings ORDER BY ts"
        ).fetchall()
    return [{"ts": r[0], "host": r[1], "latency": r[2], "lost": r[3]}
            for r in rows]


def load_dns(conn) -> list[dict]:
    with DB_LOCK:
        rows = conn.execute(
            "SELECT ts, domain, resolve, failed FROM dns ORDER BY ts"
        ).fetchall()
    return [{"ts": r[0], "domain": r[1], "resolve": r[2], "failed": r[3]}
            for r in rows]


def load_throughput(conn) -> list[dict]:
    with DB_LOCK:
        rows = conn.execute(
            "SELECT ts, bytes_sent, bytes_recv, packets_sent, packets_recv,"
            "errin, errout, dropin, dropout FROM throughput ORDER BY ts"
        ).fetchall()
    return [{"ts": r[0], "bytes_sent": r[1], "bytes_recv": r[2],
             "packets_sent": r[3], "packets_recv": r[4],
             "errin": r[5], "errout": r[6],
             "dropin": r[7], "dropout": r[8]} for r in rows]


def load_events(conn) -> list[dict]:
    with DB_LOCK:
        rows = conn.execute(
            "SELECT ts, kind, detail FROM events ORDER BY ts"
        ).fetchall()
    return [{"ts": r[0], "kind": r[1], "detail": r[2]} for r in rows]

# ---------------------------------------------------------------------------
# Compute derived chart data + summary  →  JSON-serialisable dict
# ---------------------------------------------------------------------------

def build_api_data(conn) -> dict:
    """Load everything from the DB and return a dict ready for JSON."""
    pings = load_pings(conn)
    dns_data = load_dns(conn)
    tp_data = load_throughput(conn)
    events = load_events(conn)

    if not pings:
        return {"empty": True}

    hosts = sorted(set(p["host"] for p in pings))

    # --- latency per host ---
    latency = {}
    for host in hosts:
        latency[host] = [{"x": p["ts"], "y": p["latency"]}
                         for p in pings
                         if p["host"] == host and p["latency"] is not None]

    # --- rolling packet loss % (window 20) ---
    loss = {}
    for host in hosts:
        hp = [p for p in pings if p["host"] == host]
        w = 20
        pts = []
        for i in range(w, len(hp) + 1):
            chunk = hp[i - w:i]
            pts.append({"x": chunk[-1]["ts"],
                        "y": round(100 * sum(1 for c in chunk if c["lost"]) / w, 1)})
        loss[host] = pts

    # --- jitter (rolling stdev of 10 latencies) ---
    jitter = {}
    for host in hosts:
        lats = [(p["ts"], p["latency"]) for p in pings
                if p["host"] == host and p["latency"] is not None]
        w = 10
        pts = []
        for i in range(w, len(lats) + 1):
            vals = [l[1] for l in lats[i - w:i]]
            if len(vals) > 1:
                pts.append({"x": lats[i - 1][0],
                            "y": round(statistics.stdev(vals), 2)})
        jitter[host] = pts

    # --- DNS resolution ---
    domains = sorted(set(d["domain"] for d in dns_data))
    dns = {}
    for domain in domains:
        dns[domain] = [{"x": d["ts"], "y": d["resolve"]}
                       for d in dns_data
                       if d["domain"] == domain and not d["failed"]]

    # --- throughput rate ---
    tp_down, tp_up = [], []
    for i in range(1, len(tp_data)):
        prev, cur = tp_data[i - 1], tp_data[i]
        dt = (datetime.fromisoformat(cur["ts"])
              - datetime.fromisoformat(prev["ts"])).total_seconds()
        if dt > 0:
            tp_down.append({"x": cur["ts"],
                            "y": round((cur["bytes_recv"] - prev["bytes_recv"]) * 8 / 1000 / dt, 1)})
            tp_up.append({"x": cur["ts"],
                          "y": round((cur["bytes_sent"] - prev["bytes_sent"]) * 8 / 1000 / dt, 1)})

    # --- event annotations (for embedded Chart.js fallback) ---
    annotations = []
    for e in events:
        if e["kind"] not in ("disconnect", "reconnect"):
            continue
        c = "#ef4444" if e["kind"] == "disconnect" else "#22c55e"
        lbl = "DISCONNECT" if e["kind"] == "disconnect" else "RECONNECT"
        annotations.append({
            "type": "line", "xMin": e["ts"], "xMax": e["ts"],
            "borderColor": c, "borderWidth": 2, "borderDash": [4, 4],
            "label": {"display": True, "content": lbl, "position": "start",
                      "backgroundColor": c, "color": "#fff",
                      "font": {"size": 10}},
        })

    # --- summary stats ---
    summary = {"ping": {}, "dns": {}, "throughput": {}, "events": {}}

    for host in hosts:
        lvals = [p["latency"] for p in pings
                 if p["host"] == host and p["latency"] is not None]
        total = sum(1 for p in pings if p["host"] == host)
        lost_n = sum(1 for p in pings if p["host"] == host and p["lost"])
        s = {"total": total, "lost": lost_n,
             "loss_pct": round(100 * lost_n / total, 1) if total else 0}
        if lvals:
            s["min"] = round(min(lvals), 2)
            s["max"] = round(max(lvals), 2)
            s["avg"] = round(statistics.mean(lvals), 2)
            s["median"] = round(statistics.median(lvals), 2)
            s["stdev"] = round(statistics.stdev(lvals), 2) if len(lvals) > 1 else 0
            diffs = [abs(lvals[j] - lvals[j - 1]) for j in range(1, len(lvals))]
            s["jitter"] = round(statistics.mean(diffs), 2) if diffs else 0
        summary["ping"][host] = s

    for domain in domains:
        resolves = [d["resolve"] for d in dns_data
                    if d["domain"] == domain and not d["failed"]]
        total = sum(1 for d in dns_data if d["domain"] == domain)
        failed = sum(1 for d in dns_data if d["domain"] == domain and d["failed"])
        ds = {"total": total, "failed": failed}
        if resolves:
            ds["avg"] = round(statistics.mean(resolves), 2)
            ds["max"] = round(max(resolves), 2)
        summary["dns"][domain] = ds

    if len(tp_data) >= 2:
        first, last = tp_data[0], tp_data[-1]
        dur = (datetime.fromisoformat(last["ts"])
               - datetime.fromisoformat(first["ts"])).total_seconds()
        if dur > 0:
            summary["throughput"] = {
                "duration_s": round(dur, 1),
                "avg_down_kbps": round(
                    (last["bytes_recv"] - first["bytes_recv"]) * 8 / 1000 / dur, 1),
                "avg_up_kbps": round(
                    (last["bytes_sent"] - first["bytes_sent"]) * 8 / 1000 / dur, 1),
                "total_dropin": last["dropin"] - first["dropin"],
                "total_dropout": last["dropout"] - first["dropout"],
                "total_errin": last["errin"] - first["errin"],
                "total_errout": last["errout"] - first["errout"],
            }

    summary["events"] = {
        "disconnections": sum(1 for e in events if e["kind"] == "disconnect"),
        "reconnections": sum(1 for e in events if e["kind"] == "reconnect"),
    }

    return {
        "empty": False,
        "updated": datetime.now(timezone.utc).isoformat(),
        "hosts": hosts,
        "domains": domains,
        "colors": COLORS,
        "latency": latency,
        "loss": loss,
        "jitter": jitter,
        "dns": dns,
        "tp_down": tp_down,
        "tp_up": tp_up,
        "annotations": annotations,
        "events_raw": [{"ts": e["ts"], "kind": e["kind"], "detail": e["detail"]}
                       for e in events],
        "summary": summary,
    }

# ---------------------------------------------------------------------------
# Live dashboard HTML  (fetches /api/data via JS, no page reloads)
# ---------------------------------------------------------------------------

DASHBOARD_HTML = textwrap.dedent("""\
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Network Profiler</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@3"></script>
<script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation@3"></script>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:system-ui,-apple-system,sans-serif;background:#0f172a;color:#e2e8f0;padding:20px}
  h1{font-size:1.5rem;margin-bottom:4px}
  .meta{color:#94a3b8;font-size:.85rem;margin-bottom:20px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px}
  @media(max-width:900px){.grid{grid-template-columns:1fr}}
  .card{background:#1e293b;border-radius:10px;padding:16px;border:1px solid #334155}
  .card h2{font-size:.95rem;color:#94a3b8;margin-bottom:10px}
  canvas{width:100%!important;height:260px!important}
  table{width:100%;border-collapse:collapse;font-size:.85rem;margin-top:8px}
  th,td{text-align:left;padding:6px 10px;border-bottom:1px solid #334155}
  th{color:#94a3b8;font-weight:600}
  .loss{color:#ef4444;font-weight:700}
  .stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:20px}
  .stat{background:#1e293b;border-radius:8px;padding:14px;border:1px solid #334155;text-align:center}
  .stat .val{font-size:1.4rem;font-weight:700;color:#3b82f6}
  .stat .lbl{font-size:.75rem;color:#94a3b8;margin-top:2px}
  .stat.warn .val{color:#f59e0b}
  .stat.bad .val{color:#ef4444}
  .full{grid-column:1/-1}
  #status{display:inline-block;width:8px;height:8px;border-radius:50%;background:#22c55e;margin-right:6px}
  #status.dead{background:#ef4444}
</style>
</head>
<body>
<h1>Network Profiler Dashboard</h1>
<p class="meta"><span id="status"></span>Last updated: <span id="updated">—</span></p>

<div class="stat-grid">
  <div class="stat" id="sDisc"><div class="val" id="vDisc">—</div><div class="lbl">Disconnections</div></div>
  <div class="stat" id="sRecon"><div class="val" id="vRecon">—</div><div class="lbl">Reconnections</div></div>
  <div class="stat"><div class="val" id="vDown">—</div><div class="lbl">Avg Down (kbps)</div></div>
  <div class="stat"><div class="val" id="vUp">—</div><div class="lbl">Avg Up (kbps)</div></div>
  <div class="stat" id="sDropIn"><div class="val" id="vDropIn">—</div><div class="lbl">Packets Dropped (in)</div></div>
  <div class="stat" id="sDropOut"><div class="val" id="vDropOut">—</div><div class="lbl">Packets Dropped (out)</div></div>
  <div class="stat"><div class="val" id="vDuration">—</div><div class="lbl">Monitoring (sec)</div></div>
</div>

<div class="grid">
  <div class="card"><h2>Ping Latency (ms)</h2><canvas id="cLatency"></canvas></div>
  <div class="card"><h2>Packet Loss % (rolling 20)</h2><canvas id="cLoss"></canvas></div>
  <div class="card"><h2>Jitter / Latency StdDev (ms, rolling 10)</h2><canvas id="cJitter"></canvas></div>
  <div class="card"><h2>DNS Resolution (ms)</h2><canvas id="cDns"></canvas></div>
  <div class="card full"><h2>Throughput (kbps)</h2><canvas id="cThroughput"></canvas></div>
</div>

<div class="card" style="margin-bottom:20px">
  <h2>Ping Summary</h2>
  <table>
    <thead><tr><th>Host</th><th>Avg (ms)</th><th>Min</th><th>Max</th><th>Jitter</th><th>Loss</th><th>Probes</th></tr></thead>
    <tbody id="tPing"></tbody>
  </table>
</div>
<div class="card">
  <h2>DNS Summary</h2>
  <table>
    <thead><tr><th>Domain</th><th>Avg (ms)</th><th>Max (ms)</th><th>Failures</th></tr></thead>
    <tbody id="tDns"></tbody>
  </table>
</div>

<script>
const POLL_MS = 5000;
const COLORS = ["#3b82f6","#ef4444","#22c55e","#f59e0b","#8b5cf6","#ec4899","#14b8a6","#f97316"];

const commonScales = {
  x:{type:'time',time:{tooltipFormat:'HH:mm:ss',displayFormats:{second:'HH:mm:ss',minute:'HH:mm'}},
     ticks:{color:'#64748b',maxTicksLimit:12},grid:{color:'#1e293b'}},
  y:{ticks:{color:'#64748b'},grid:{color:'#334155'}}
};
function mkOpts(annotations){
  return {responsive:true,animation:false,
    plugins:{legend:{labels:{color:'#94a3b8',boxWidth:12}},
             annotation:{annotations:annotations||[]}},
    scales:commonScales};
}
function mkDs(label,color,data,fill){
  return {label,data,borderColor:color,backgroundColor:color+'20',
          borderWidth:1.5,pointRadius:0,tension:0.3,fill:!!fill};
}

let charts = {};
let inited = false;

function initCharts(d){
  // latency
  let ds = d.hosts.map((h,i)=>mkDs(h,COLORS[i%COLORS.length],d.latency[h]));
  charts.lat = new Chart('cLatency',{type:'line',data:{datasets:ds},options:mkOpts(d.annotations)});

  ds = d.hosts.map((h,i)=>mkDs(h,COLORS[i%COLORS.length],d.loss[h]));
  charts.loss = new Chart('cLoss',{type:'line',data:{datasets:ds},options:mkOpts(d.annotations)});

  ds = d.hosts.map((h,i)=>mkDs(h,COLORS[i%COLORS.length],d.jitter[h]));
  charts.jitter = new Chart('cJitter',{type:'line',data:{datasets:ds},options:mkOpts(d.annotations)});

  ds = d.domains.map((dm,i)=>mkDs(dm,COLORS[i%COLORS.length],d.dns[dm]));
  charts.dns = new Chart('cDns',{type:'line',data:{datasets:ds},options:mkOpts(d.annotations)});

  charts.tp = new Chart('cThroughput',{type:'line',data:{datasets:[
    mkDs('Download','#3b82f6',d.tp_down,true),
    mkDs('Upload','#22c55e',d.tp_up,true)
  ]},options:mkOpts(d.annotations)});

  inited = true;
}

function updateCharts(d){
  // update datasets in-place
  d.hosts.forEach((h,i)=>{
    if(charts.lat.data.datasets[i]) charts.lat.data.datasets[i].data = d.latency[h];
    if(charts.loss.data.datasets[i]) charts.loss.data.datasets[i].data = d.loss[h];
    if(charts.jitter.data.datasets[i]) charts.jitter.data.datasets[i].data = d.jitter[h];
  });

  // handle new hosts appearing after init
  while(charts.lat.data.datasets.length < d.hosts.length){
    let i = charts.lat.data.datasets.length;
    let h = d.hosts[i], c = COLORS[i%COLORS.length];
    charts.lat.data.datasets.push(mkDs(h,c,d.latency[h]));
    charts.loss.data.datasets.push(mkDs(h,c,d.loss[h]));
    charts.jitter.data.datasets.push(mkDs(h,c,d.jitter[h]));
  }

  d.domains.forEach((dm,i)=>{
    if(charts.dns.data.datasets[i]) charts.dns.data.datasets[i].data = d.dns[dm];
  });
  while(charts.dns.data.datasets.length < d.domains.length){
    let i = charts.dns.data.datasets.length;
    charts.dns.data.datasets.push(mkDs(d.domains[i],COLORS[i%COLORS.length],d.dns[d.domains[i]]));
  }

  charts.tp.data.datasets[0].data = d.tp_down;
  charts.tp.data.datasets[1].data = d.tp_up;

  // update annotations on all charts
  [charts.lat,charts.loss,charts.jitter,charts.dns,charts.tp].forEach(ch=>{
    ch.options.plugins.annotation.annotations = d.annotations;
    ch.update('none');   // 'none' = skip animations
  });
}

function updateStats(d){
  const s = d.summary;
  const ev = s.events||{};
  const tp = s.throughput||{};

  document.getElementById('vDisc').textContent   = ev.disconnections??'—';
  document.getElementById('vRecon').textContent  = ev.reconnections??'—';
  document.getElementById('vDown').textContent   = tp.avg_down_kbps??'—';
  document.getElementById('vUp').textContent     = tp.avg_up_kbps??'—';
  document.getElementById('vDropIn').textContent = tp.total_dropin??'—';
  document.getElementById('vDropOut').textContent= tp.total_dropout??'—';
  document.getElementById('vDuration').textContent= tp.duration_s??'—';

  document.getElementById('sDisc').className   = 'stat'+((ev.disconnections>0)?' bad':'');
  document.getElementById('sDropIn').className = 'stat'+((tp.total_dropin>0)?' warn':'');
  document.getElementById('sDropOut').className= 'stat'+((tp.total_dropout>0)?' warn':'');

  // ping table
  let html = '';
  for(const h of d.hosts){
    const p = (s.ping||{})[h]||{};
    const lossClass = (p.loss_pct>2)?'loss':'';
    html += `<tr><td>${h}</td><td>${p.avg??'—'}</td><td>${p.min??'—'}</td>`
          + `<td>${p.max??'—'}</td><td>${p.jitter??'—'}</td>`
          + `<td class="${lossClass}">${p.loss_pct??'—'}%</td><td>${p.total??'—'}</td></tr>`;
  }
  document.getElementById('tPing').innerHTML = html;

  // dns table
  html = '';
  for(const dm of d.domains){
    const dd = (s.dns||{})[dm]||{};
    html += `<tr><td>${dm}</td><td>${dd.avg??'—'}</td>`
          + `<td>${dd.max??'—'}</td><td>${dd.failed??0}/${dd.total??0}</td></tr>`;
  }
  document.getElementById('tDns').innerHTML = html;

  // timestamp
  if(d.updated){
    const t = new Date(d.updated);
    document.getElementById('updated').textContent = t.toLocaleTimeString();
  }
}

let failCount = 0;
async function poll(){
  try {
    const r = await fetch('/api/data');
    const d = await r.json();
    if(d.empty) return;
    if(!inited) initCharts(d); else updateCharts(d);
    updateStats(d);
    failCount = 0;
    document.getElementById('status').className = '';
  } catch(e) {
    failCount++;
    if(failCount > 3) document.getElementById('status').className = 'dead';
  }
}

poll();
setInterval(poll, POLL_MS);
</script>
</body></html>
""")

# ---------------------------------------------------------------------------
# Static HTML snapshot (data baked in — works offline)
# ---------------------------------------------------------------------------

def build_static_html(api_data: dict) -> str:
    """Bake api_data into the dashboard HTML so it works as a standalone file."""
    # We reuse the same dashboard HTML but replace the fetch-based JS
    # with an inline data assignment + one-shot init.
    data_json = json.dumps(api_data)
    return DASHBOARD_HTML.replace(
        "poll();\nsetInterval(poll, POLL_MS);",
        f"const _STATIC = {data_json};\n"
        "if(!_STATIC.empty){ initCharts(_STATIC); updateStats(_STATIC); }\n"
        "document.getElementById('status').className = 'dead';\n"
        "document.querySelector('.meta').innerHTML = "
        "'<span id=\"status\" class=\"dead\"></span>Static snapshot — profiler not running';",
    )

# ---------------------------------------------------------------------------
# WebSocket connection manager
# ---------------------------------------------------------------------------

class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        async with self._lock:
            self.active_connections.append(websocket)

    async def disconnect(self, websocket: WebSocket):
        async with self._lock:
            if websocket in self.active_connections:
                self.active_connections.remove(websocket)

    async def broadcast(self, data: dict):
        async with self._lock:
            for connection in list(self.active_connections):
                try:
                    await connection.send_json(data)
                except Exception:
                    if connection in self.active_connections:
                        self.active_connections.remove(connection)

manager = ConnectionManager()

# ---------------------------------------------------------------------------
# App state (set in main() before uvicorn starts)
# ---------------------------------------------------------------------------

_state: dict = {
    "conn": None,
    "collector": None,
    "args": None,
    "duration_sec": None,
    "collect_thread": None,
}

# ---------------------------------------------------------------------------
# FastAPI app with lifespan
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app):
    # --- Startup ---
    loop = asyncio.get_event_loop()
    collector = _state["collector"]
    collector._loop = loop

    collect_thread = threading.Thread(target=collector.run, daemon=True)
    collect_thread.start()
    _state["collect_thread"] = collect_thread

    duration_sec = _state["duration_sec"]
    if duration_sec:
        async def _duration_timer():
            await asyncio.sleep(duration_sec)
            _print(f"\nDuration reached ({_state['args'].duration}) — stopping…")
            os.kill(os.getpid(), signal.SIGINT)
        asyncio.create_task(_duration_timer())

    yield

    # --- Shutdown ---
    collector.stop()
    collect_thread.join(timeout=5)
    conn = _state["conn"]
    args = _state["args"]
    data = build_api_data(conn)
    if not data.get("empty"):
        html = build_static_html(data)
        tmp = args.output + ".tmp"
        with open(tmp, "w") as f:
            f.write(html)
        os.replace(tmp, args.output)
        _print(f"Static snapshot saved to {os.path.abspath(args.output)}")
    conn.close()


app = FastAPI(lifespan=lifespan)


@app.get("/api/data")
def api_data():
    data = build_api_data(_state["conn"])
    return JSONResponse(content=data)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        # Send full dataset immediately on connect
        data = build_api_data(_state["conn"])
        await websocket.send_json(data)
        # Keep connection alive; client doesn't send messages
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        await manager.disconnect(websocket)
    except Exception:
        await manager.disconnect(websocket)


@app.get("/{path:path}")
def serve_frontend(path: str):
    """Serve React frontend if built, otherwise fall back to embedded HTML."""
    dist_dir = os.path.join(_script_dir, "frontend", "dist")

    if os.path.isdir(dist_dir):
        file_path = os.path.join(dist_dir, path) if path else None

        # Serve the exact file if it exists
        if file_path and os.path.isfile(file_path):
            ct = mimetypes.guess_type(file_path)[0] or "application/octet-stream"
            with open(file_path, "rb") as f:
                return Response(content=f.read(), media_type=ct)

        # SPA fallback: serve index.html for any unmatched route
        index_path = os.path.join(dist_dir, "index.html")
        if os.path.isfile(index_path):
            with open(index_path, "rb") as f:
                return HTMLResponse(content=f.read().decode())

    # No frontend build — serve embedded Chart.js dashboard
    return HTMLResponse(content=DASHBOARD_HTML)

# ---------------------------------------------------------------------------
# Collector
# ---------------------------------------------------------------------------

class Collector:
    def __init__(self, conn, targets, dns_domains, interval,
                 ws_manager=None):
        self.conn = conn
        self.targets = targets
        self.dns_domains = dns_domains
        self.interval = interval
        self.stop_event = threading.Event()
        self._host_up: dict[str, bool] = {h: True for h in targets}
        self._ws_manager = ws_manager
        self._loop = None  # set by lifespan startup

    def run(self):
        db_insert_event(self.conn, "start",
                        f"targets={list(self.targets.keys())}")
        round_num = 0
        while not self.stop_event.is_set():
            start = time.monotonic()
            round_num += 1

            # --- Pings (parallel per host) ---
            threads: list[threading.Thread] = []
            results: list[dict] = []
            lock = threading.Lock()

            def _ping(host):
                r = ping_host(host)
                with lock:
                    results.append(r)

            for host in self.targets.values():
                t = threading.Thread(target=_ping, args=(host,), daemon=True)
                threads.append(t)
                t.start()
            for t in threads:
                t.join()

            for r in results:
                db_insert_ping(self.conn, r)
                host = r["host"]
                was_up = self._host_up.get(host, True)
                is_up = not r["lost"]
                if was_up and not is_up:
                    db_insert_event(self.conn, "disconnect", host)
                    _print(f"  !! DISCONNECT detected: {host}")
                elif not was_up and is_up:
                    db_insert_event(self.conn, "reconnect", host)
                    _print(f"  >> Reconnected: {host}")
                self._host_up[host] = is_up

            # --- DNS (every 5th round) ---
            if round_num % 5 == 1:
                for domain in self.dns_domains:
                    d = measure_dns(domain)
                    db_insert_dns(self.conn, d)

            # --- Throughput snapshot ---
            tp = get_throughput_snapshot()
            db_insert_throughput(self.conn, tp)

            # --- Console status ---
            ok = sum(1 for r in results if not r["lost"])
            lat = [r["latency_ms"] for r in results
                   if r["latency_ms"] is not None]
            avg = f"{statistics.mean(lat):.1f}" if lat else "—"
            _print(
                f"[{datetime.now().strftime('%H:%M:%S')}] "
                f"ping {ok}/{len(results)} ok  avg={avg} ms"
            )

            # --- Broadcast to WebSocket clients ---
            if self._ws_manager and self._loop:
                try:
                    data = build_api_data(self.conn)
                    asyncio.run_coroutine_threadsafe(
                        self._ws_manager.broadcast(data), self._loop
                    )
                except Exception:
                    pass

            elapsed = time.monotonic() - start
            remaining = self.interval - elapsed
            if remaining > 0:
                self.stop_event.wait(remaining)

    def stop(self):
        self.stop_event.set()


def _print(msg):
    print(msg, flush=True)

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Network profiler with live HTML dashboard.")
    parser.add_argument("--interval", type=float, default=DEFAULT_INTERVAL,
                        help="Seconds between ping rounds (default: 2)")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT,
                        help=f"HTTP server port (default: {DEFAULT_PORT})")
    parser.add_argument("--output", default=DEFAULT_HTML,
                        help="Path to static HTML snapshot on shutdown")
    parser.add_argument("--db", default=DEFAULT_DB,
                        help="Path to SQLite database file")
    parser.add_argument("--targets", nargs="+",
                        help="Hosts/IPs to ping (default: gateway + DNS + internet)")
    parser.add_argument("--dns-domains", nargs="+", default=DEFAULT_DNS_DOMAINS,
                        help="Domains for DNS resolution tests")
    parser.add_argument("--duration", type=str, default=None,
                        help="How long to run (e.g. 30s, 10m, 2h). "
                             "Default: run until Ctrl-C")
    args = parser.parse_args()

    duration_sec = None
    if args.duration:
        duration_sec = parse_duration(args.duration)

    # Build targets dict
    gw = get_default_gateway()
    if args.targets:
        targets = {t: t for t in args.targets}
    else:
        targets = {}
        if gw:
            targets["gateway"] = gw
        targets["cloudflare-dns"] = "1.1.1.1"
        targets["google-dns"] = "8.8.8.8"
        targets["google.com"] = "google.com"
        targets["claude.ai"] = "claude.ai"
        targets["github.com"] = "github.com"
        targets["cloudflare.com"] = "cloudflare.com"

    _print("=" * 60)
    _print("  Network Profiler")
    _print("=" * 60)
    _print(f"  Targets:    {', '.join(f'{k}={v}' for k,v in targets.items())}")
    _print(f"  Interval:   {args.interval}s")
    _print(f"  Dashboard:  http://localhost:{args.port}")
    _print(f"  Snapshot:   {os.path.abspath(args.output)}")
    _print(f"  Database:   {os.path.abspath(args.db)}")
    _print(f"  DNS tests:  {', '.join(args.dns_domains)}")
    if duration_sec:
        _print(f"  Duration:   {args.duration} ({duration_sec:.0f}s)")
    else:
        _print("  Duration:   until Ctrl-C")
    _print("  Press Ctrl-C to stop early.")
    _print("=" * 60)

    conn = init_db(args.db)

    collector = Collector(conn, targets, args.dns_domains, args.interval,
                          ws_manager=manager)

    _state["conn"] = conn
    _state["collector"] = collector
    _state["args"] = args
    _state["duration_sec"] = duration_sec

    uvicorn.run(app, host="0.0.0.0", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
