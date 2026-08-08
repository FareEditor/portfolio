// INTEGRATION: весь текст уходит в CMS отсюда; в разметке строк нет
export default {
  cta: "Start a project",
  nav: ["Work", "Process", "About", "Contact"],
  hero: {
    // status живёт в data/settings.json (правится через CMS без правки кода)
    title: "Long-form video editing and motion graphics",
    sub: "Full post-production in one place — cut, graphics, sound, colour. You send the footage, you get a finished video.",
    primary: "View work",
    secondary: "Watch showreel"
  },
  proof: {
    eyebrow: "TRUSTED BY",
    title: "Worked with YouTube channels totalling",
    number: "1,300,000+ subscribers",
    industries: "Gaming · Real estate · Personal brands · Economics & finance"
  },
  work: {
    eyebrow: "WORK",
    title: "Selected projects",
    motionTitle: "Motion fragments",
    watch: "Watch on YouTube ↗",
    showAll: "Show all",
    play: "Play",
    thumb: "16:9 preview"
  },
  process: {
    eyebrow: "HOW IT WORKS",
    title: "Three steps to a finished video",
    steps: [
      { tc: "BEFORE DAY 1", title: "Brief", body: "We go over the project, references and deadline. Timelines are agreed upfront; if yours is tight, say so early. The clock starts when the footage arrives." },
      { tc: "DAY 1–6", title: "Edit", body: "Rough cut for approval, then revisions. You see progress, not a week of silence." },
      { tc: "DAY 7", title: "Delivery", body: "Final master in the formats you need. A 10-minute video takes one week from start." }
    ]
  },
  why: {
    eyebrow: "WHY ME",
    title: "What you get besides the edit",
    items: [
      { title: "No generative AI", body: "No AI upscaling, no synthetic voices, no generated inserts. Every asset is cleared — no surprises from the platforms later." },
      { title: "Russian and English", body: "I work with creators in any time zone. Communication is asynchronous and deadlines don't suffer for it." },
      { title: "19 months on a single channel", body: "From October 2023 to May 2025 I was the in-house editor for gaming channel Eiriley, which grew by 15,000 subscribers over that period. I'm built for long-term work, not one-off jobs." },
      { title: "I write my own tools", body: "Routine work — sorting and prepping footage — gets automated in code rather than done by hand. Less time on logistics, more on the edit." }
    ]
  },
  faq: {
    eyebrow: "QUESTIONS",
    title: "What clients usually ask",
    items: [
      { q: "What does it cost?", a: "It depends on runtime, the amount of graphics and the deadline. The floor is $200. I give an exact quote after the brief and a rough range in my first reply." },
      { q: "How long does it take?", a: "A 10-minute video takes one week from start. Timelines are agreed before work begins — if you have a hard deadline, mention it in your first message." },
      { q: "How do I send the footage?", a: "Whatever works for you: Google Drive, Dropbox, any file host. We'll settle format and codec at the brief so nothing gets compressed twice." },
      { q: "How many revisions are included?", a: "Two rounds within the agreed scope. Beyond that we discuss it — at that point it's usually a change of direction rather than a fix." },
      { q: "Do you work with clients abroad?", a: "Yes. Russian and English, fully asynchronous, time zones aren't a factor." },
      { q: "Do you use AI?", a: "No. Not for footage, not for voice, not for upscaling. Everything is done by hand and every asset is cleared." }
    ]
  },
  contact: {
    eyebrow: "CONTACT",
    title: "Tell me about the project",
    text: "Describe the job in a couple of lines — I'll come back with a price range and a timeline.",
    reply: "I reply within 24 hours",
    labels: { name: "Your name", contact: "How to reach you", project_type: "Project type", budget: "Budget", message: "About the project" },
    hint: "Email, Telegram — whatever suits you",
    choose: "Select",
    required: "Required",
    button: "Send request",
    sending: "Sending",
    success: "Request sent. I'll reply within 24 hours.",
    error: "Couldn't send that. Check your connection and try again — or reach out on X.",
    alt: "Or message me on X →",
    micro: "Your details are used only to reply to this request. Stored for 90 days, then deleted.",
    // value — стабильный ключ схемы (валидируется воркером), label — витрина
    project_type: [
      { value: "long_form", label: "Long-form video (10+ minutes)" },
      { value: "motion_graphics", label: "Motion graphics" },
      { value: "series", label: "Video series" },
      { value: "other", label: "Something else" }
    ],
    budget: [
      { value: "200_500", label: "$200–500" },
      { value: "500_1000", label: "$500–1,000" },
      { value: "1000_2000", label: "$1,000–2,000" },
      { value: "2000_plus", label: "$2,000+" }
    ]
  },
  footer: {
    copy: "© FARE 2026",
    links: [
      { label: "Telegram", href: "https://t.me/fareeditor" },
      { label: "Email", href: "mailto:contact@fareeditor.com" },
      { label: "X", href: "https://x.com/FareEditor" }
    ]
  }
};
