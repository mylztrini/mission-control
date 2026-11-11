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
  helpdesk: {
    generated_at: "2026-11-08T12:00:00Z",
    metrics: {
      not_closed_or_resolved: 2,
      open: 1,
      pending: 1,
      waiting_on_customer: 0,
      waiting_on_us: 1,
      new_this_week: 1,
      resolved_this_week: 0,
      oldest_open_days: 4,
      avg_first_response_hours_30d: 5,
      first_response_sample_30d: 3
    },
    attention: { critical: 0, concerning: 0, tickets: [], rules: "Synthetic rules." },
    key_tickets: { waiting_on_us_longest: [], high_priority: [], oldest_unresolved: [] },
    by_client: [{ name: "Example Client", short: "Example", active: 1, new_this_week: 1, total: 4, key: true, missing: false }]
  },
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
      { k: "Open asks", v: "2", sub: "Sample queue", bad: true, tab: "today" },
      { k: "Agency overdue", v: "SIMCL TT$1,234.00 · SiBB BDS$2,345.00 · SI CY US$3,456.00", sub: "outstanding SIMCL TT$9,000.00 · SiBB BDS$8,000.00 · SI CY US$3,456.00 · Cashbot, Tue 10 Nov, 5:46 PM AST", bad: true, tab: "money", source: "Cashbot", asof: "Tue 10 Nov, 5:46 PM AST", companies: [
        { company: "SIMCL", currency: "TTD", overdue_lbl: "TT$1,234.00", outstanding_lbl: "TT$9,000.00" },
        { company: "SiBB", currency: "BBD", overdue_lbl: "BDS$2,345.00", outstanding_lbl: "BDS$8,000.00" },
        { company: "SI CY", currency: "USD", overdue_lbl: "US$3,456.00", outstanding_lbl: "US$3,456.00" }
      ] }
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
      revenue_caption: "Synthetic revenue TT$9,999",
      revenue: [{
        month: "Nov",
        when: "sample",
        total_tt_lbl: "TT$1,500",
        total_usd_lbl: "US$200",
        airbnb_usd: "US$200",
        airbnb_n: "1 stay",
        direct_tt: "TT$0",
        direct_n: "none"
      }],
      top_villa: "Sample Nest",
      occ_caption: "Synthetic occupancy",
      occupancy: [{ villa: "Sample Nest", pct: 40, warn: false, months: [{ m: "Nov", pct: 40 }], open_nts_90: 10 }],
      arrivals: [{ text: "Sample Guest · Sample Nest", chan: "fixture", g: "Not a real guest" }],
      next_move: "Synthetic next move. Mail sample.guest@example.com or call (868) 555-0199.",
      airbnb: {
        total_tt: "TT$6,600",
        total_usd: "US$1,000",
        n: 1,
        next: { g: "Sample Guest", v: "Sample Nest", ttd: "TT$6,600", payout: "10 Nov" },
        months: [{ m: "Nov", tt: "TT$6,600", usd: "US$1,000", n: "1" }]
      },
      direct: {
        total_tt: "TT$3,300",
        total_usd: "US$500",
        n_open: 1,
        efficiency: { sub: "Synthetic collection", pct: "80%" },
        bookings: [{ g: "Jamie Example", v: "Sample Nest", ci: "12 Nov", bal_tt: "TT$3,300", bal_usd: "US$500", warn: true, st: "balance due" }]
      },
      feedback: null,
      pnl: {
        rules: "Synthetic rules only.",
        headline: { revenue_tt: 20000, revenue_basis: "actual", overheads_tt: 7655, overheads_basis: "actual" },
        rate: { fixed: true, usd_ttd: 7.8, label: "sample villa rate", live_ref: { usd_ttd: 6.8 } },
        months: [{
          label: "Nov",
          partial: false,
          revenue: { tt: 20000, usd: 2564, basis: "actual" },
          overheads: { tt: 7655, basis: "actual", note: "Synthetic overheads" },
          profit: { tt: 12345, basis: "actual" }
        }]
      },
      profit: { month: "Nov", tt: 12345, basis: "actual", partial: false }
    },
    money: {
      networth: {
        as_of: "1 Nov 2026",
        currency: "TTD",
        total: 123456,
        business: 80000,
        personal: 43456,
        note: "Synthetic snapshot. Not a real balance.",
        lines: [
          { label: "Sample operating account", value: "TT$80,000" },
          { label: "Sample savings", value: "TT$43,456" }
        ]
      },
      weeks_caption: "Synthetic weeks",
      weeks: [{ label: "Sample", rng: "fixture", tt: "TT$8,500", usd: "US$1,250", n: 1, items: [{ when: "Mon", g: "Jamie Example", v: "Sample Nest", src: "Airbnb", amt: "US$1,250" }] }],
      months_caption: "Synthetic months",
      months: [{ m: "Nov", tot: "1.2", airbnb: "1.0", direct: "0.2" }],
      payables: { note: "Synthetic payables of TT$400.", links: [] },
      agency: {
        asof: "2 Nov 2026",
        total: "TT$4,321",
        overdue: "TT$1,111",
        summary: "Synthetic receivables for Example Client.",
        invoices: [{ num: "INV-1001", client: "Example Client", amt: "TT$4,321", bucket: "overdue" }]
      }
    },
    growth: {
      pipeline: {
        deals: "1",
        summary: "Synthetic pipeline for Example Client.",
        hot: [{ stage: "Talking", warn: false, who: "Example Client", text: "Sample deal at TT$50,000.", url: "" }]
      },
      ads: {
        account: "Sample Ads",
        window: "1–7 Nov",
        stale: false,
        kpis: [{ k: "Spend", v: "TT$2,400", sub: "this week", delta: "+5%" }],
        story: "Synthetic ad story for the sample account.",
        campaigns: [{ name: "Sample campaign", tag: "", status: "On", spend: "TT$2,400", clicks: "120", ctr: "1.5%" }]
      },
      ad_plan: {
        note: "Synthetic plan.",
        months: [{ m: "Nov", posture: "Steady", spend: "TT$2,400", why: "Sample only" }]
      }
    }
  },
  ads_weekly: {
    timezone: "America/Port_of_Spain",
    currency: "USD",
    as_of: "2026-11-09T19:00:00-04:00",
    combined_known_spend: 150.00,
    weekly_rows_sum: 150.00,
    columns: [
      { key: "meta:1", channel: "meta", name: "Sample Account", id: "1", label: "Meta · Sample Account" },
      { key: "google:2", channel: "google", name: "Sample Google", id: "2", label: "Google · Sample Google" }
    ],
    account_totals: [
      { key: "meta:1", spend: 100.00 },
      { key: "google:2", spend: 50.00 }
    ],
    weeks: [
      { start: "2026-10-26", end: "2026-11-01", complete: true, channels: [
        { channel: "meta", spend: 100, accounts: [{ name: "Sample Account", id: "1", spend: 100 }] }
      ]},
      { start: "2026-11-02", end: "2026-11-08", complete: true, channels: [
        { channel: "google", spend: 50, accounts: [{ name: "Sample Google", id: "2", spend: 50 }] }
      ]}
    ],
    linkedin_time_note: "LinkedIn figures are from a Campaign Manager date picker labelled Time in UTC and were not converted to America/Port_of_Spain.",
    not_yet_pulled: [
      "Google Ads login miles@simplyintense.com",
      "LinkedIn Shell 508694935"
    ]
  },
  cash_forecast: {
    as_of: "2026-11-08",
    latest_balances_date: "2026-10-31",
    currency: "TTD unless marked USD",
    bands_ttd_usable: {
      GREEN: ">450000",
      AMBER: "300000-450000",
      RED: "175000-300000",
      CRITICAL: "<175000",
      basis: "usable cash, fixed deposits excluded"
    },
    current_position: {
      date: "2026-10-31",
      usable_cash: 520000,
      status: "GREEN",
      plan_usable_oct: 410000,
      variance_vs_plan: 110000,
      notes: ["Synthetic balances only. Not a real cash position."]
    },
    months: [
      { month: "2026-10", label: "Oct-26", plan: { closing_usable: 410000, status: "AMBER" }, latest_actual: { closing_usable: 520000, status: "GREEN", variance_vs_plan: 110000, balance_date: "2026-10-31" }, modelled_reforecast: null },
      { month: "2026-11", label: "Nov-26", plan: { closing_usable: 500000, status: "GREEN" }, latest_actual: null, modelled_reforecast: { label: "MODELLED", fill_case_closing_usable: 530000, fill_case_status: "GREEN", booked_only_floor_closing_usable: 515000, booked_only_floor_status: "GREEN" } },
      { month: "2026-12", label: "Dec-26", plan: { closing_usable: 470000, status: "GREEN" }, latest_actual: null, modelled_reforecast: { label: "MODELLED", fill_case_closing_usable: 540000, fill_case_status: "GREEN", booked_only_floor_closing_usable: 480000, booked_only_floor_status: "GREEN" } },
      { month: "2027-01", label: "Jan-27", plan: { closing_usable: 420000, status: "AMBER" }, latest_actual: null, modelled_reforecast: { label: "MODELLED", fill_case_closing_usable: 500000, fill_case_status: "GREEN", booked_only_floor_closing_usable: 390000, booked_only_floor_status: "AMBER" } },
      { month: "2027-02", label: "Feb-27", plan: { closing_usable: 360000, status: "AMBER" }, latest_actual: null, modelled_reforecast: { label: "MODELLED", fill_case_closing_usable: 470000, fill_case_status: "GREEN", booked_only_floor_closing_usable: 340000, booked_only_floor_status: "AMBER" } },
      { month: "2027-03", label: "Mar-27", plan: { closing_usable: 310000, status: "AMBER" }, latest_actual: null, modelled_reforecast: { label: "MODELLED", fill_case_closing_usable: 450000, fill_case_status: "GREEN", booked_only_floor_closing_usable: 280000, booked_only_floor_status: "RED" } },
      { month: "2027-04", label: "Apr-27", plan: { closing_usable: 240000, status: "RED" }, latest_actual: null, modelled_reforecast: { label: "MODELLED", fill_case_closing_usable: 410000, fill_case_status: "AMBER", booked_only_floor_closing_usable: 200000, booked_only_floor_status: "RED" } }
    ],
    fixed_deposit_line: {
      label: "Fixed deposits are card collateral and never count as usable cash.",
      total_usd: 12000,
      total_ttd: 80000,
      cards_they_secure_ttd: 15000,
      net_freed_if_those_cards_paid_ttd: 65000
    },
    upside_items: [
      { item: "NIB Inv 45221", ttd: 11111.11, due: "2026-11-22", status: "Synthetic invoice, not a real amount." },
      { item: "Sample milestone", ttd: 2222, status: "Not counted" }
    ],
    risks: [
      { risk: "Sample April gap", detail: "Synthetic booking gap only.", severity: "HIGH" },
      { risk: "Sample card balances", detail: "Synthetic card risk.", severity: "MEDIUM" }
    ],
    assumptions: [
      "Modelled re-forecast (labelled MODELLED): synthetic path only.",
      "Usable cash excludes fixed deposits."
    ],
    protective_lens: {
      buffer_months: 2.1,
      unpledged_usd: 9000,
      unpledged_ttd: 60000,
      household_only_buffer_months: 0.8,
      household_only_ttd: 25000,
      rungs_ttd: { "3_months": 445000, "6_months": 889000, "12_months": 1780000 },
      monthly_need_ttd: 148333,
      rung_status: "Below the 3-month rung on this synthetic snapshot",
      surplus_rule_now: "All surplus to the buffer",
      casa: { usd: 10000, usd_rate: "8%", ttd: 20000, ttd_rate: "7.5%" }
    },
    refresh_cadence: [
      { what: "Monthly Balances Input", who: "Miles", when: "Each month-end" },
      { what: "Villa pacing check-in", when: "5th of each month", source: "Hospitable" }
    ]
  }
};

export const orgFixture = {
  pillars: [],
  bots: {},
  as_of: "synthetic",
  updated_at: null


};
