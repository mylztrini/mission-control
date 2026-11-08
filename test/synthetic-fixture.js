// SYNTHETIC FIXTURE — not live Mission Control data.
// Invented labels only. No view keys, no action credentials, no private records.

export const SYNTH_KEY = "synthetic-fixture-key-not-a-secret";

const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));

export const fixture = {
  version: "synthetic-1",
  generated_at: "2026-11-08T12:00:00Z",
  configured: true,
  card_base: "https://example.invalid/cards/",
  waiting: [
    {
      key: "synthetic-wait-1",
      bot: "Sample Bot",
      botId: "bot-sample",
      when: "2h",
      text: "Synthetic task: confirm the sample checklist.",
      stale: false,
      number: 101,
      status: "open",
      src: "slack",
      actions: ["Done", "Later"],
      card: null
    },
    {
      key: "synthetic-wait-2",
      bot: "Sample Bot",
      botId: "bot-sample",
      when: "3h",
      text: "Synthetic follow-up: sample note only.",
      stale: false,
      number: 102,
      status: "open",
      src: "email",
      actions: ["Later"],
      card: null
    }
  ],
  staff: [
    {
      key: "synthetic-staff-1",
      who: "Sample Staff",
      age: "1h",
      project: "Sample Project",
      status: "waiting",
      number: 202,
      task_name: "Synthetic staff task",
      text: "Please review the sample note.",
      earlier: 0,
      url: "https://example.invalid/task/202",
      actions: ["Noted"]
    }
  ],
  bots: [
    { id: "bot-sample", name: "Sample Bot", short: "SB", working: true, doing: "Synthetic check", last: "1:00 PM" },
    { id: "bot-idle", name: "Idle Sample", short: "IS", working: false, doing: "", last: "Yesterday" }
  ],
  heatmap: {
    caption: "Synthetic activity",
    hours,
    days: ["Mon"],
    values: [hours.map((_, i) => i % 4)]
  },
  brief: { caption: "Synthetic brief", items: ["Sample brief line"], links: [] },
  captions: { timeline: "Synthetic timeline", routines: "Synthetic routines" },
  done: [{ bot: "Sample Bot", when: "1:00 PM", text: "Finished a synthetic item" }],
  routines: [["Sample routine", "Tomorrow 9:00", "Sample Bot"]],
  helpdesk: null,
  routines_all: null,
  brain: {
    as_of: "2026-11-08T11:35:00Z",
    onemove: {
      head: "Synthetic one move",
      detail: "Example detail only.",
      why: "Fixture",
      advisor_line: "Sample advisor line"
    },
    vitals: [
      { k: "Villa profit", v: "TT$12,000 sample", sub: "Synthetic month", goal: "Sample goal", bad: false, tab: "villas" },
      { k: "Booked nights", v: "40%", sub: "Sample Nest", bad: false, tab: "villas" },
      { k: "In transit", v: "TT$1,000 sample", sub: "Synthetic payout", bad: false, tab: "money" },
      { k: "Open asks", v: "2", sub: "Sample queue", bad: true, tab: "today" }
    ],
    board: {
      month: "Nov",
      take: {
        date: "2026-11-08",
        ini: "SA",
        advisor: "Sample Advisor",
        lens: "Fixture lens",
        read: "Synthetic board line.",
        do: "Sample only.",
        life: ""
      },
      scorecards: [],
      log: [],
      due: []
    },
    today: {
      sched_asof: "synthetic",
      sched: [{ t: "9:00", text: "Synthetic standup" }],
      staff: [{ name: "Sample Staff", on: true, note: "in" }],
      asana: { items: [], caption: "" }
    },
    villas: {
      revenue_caption: "Synthetic revenue",
      revenue: [{
        month: "Nov",
        when: "sample",
        total_tt_lbl: "TT$1 sample",
        total_usd_lbl: "US$1 sample",
        airbnb_usd: "1",
        airbnb_n: "1 stay",
        direct_tt: "0",
        direct_n: ""
      }],
      top_villa: "Sample Nest",
      occ_caption: "Synthetic occupancy",
      occupancy: [{ villa: "Sample Nest", pct: 40, warn: false, months: [{ m: "Nov", pct: 40 }], open_nts_90: 10 }],
      arrivals: [{ text: "Sample Guest · Sample Nest", chan: "fixture", g: "Not a real guest" }],
      next_move: "Synthetic next move.",
      airbnb: null,
      direct: null,
      feedback: null,
      pnl: { error: "Synthetic placeholder, not a real profit figure." },
      profit: null
    },
    money: {
      networth: { note: "Synthetic snapshot. Not a real balance." },
      weeks_caption: "Synthetic weeks",
      weeks: [{ label: "Sample", rng: "fixture", tt: "TT$0", usd: "US$0", n: 0, items: [] }],
      months_caption: "Synthetic months",
      months: [{ m: "Nov", tot: "0", airbnb: "0", direct: "0" }],
      payables: { note: "Synthetic payables", links: [] },
      agency: { total: "TT$0", overdue: "TT$0", summary: "Synthetic receivables.", invoices: [] }
    },
    growth: {
      pipeline: { deals: "0", summary: "Synthetic pipeline.", hot: [] }
    }
  }
};

export const orgFixture = {
  pillars: [],
  bots: {},
  as_of: "synthetic",
  updated_at: null
};
