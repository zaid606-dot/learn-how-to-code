// A canned verdict used by "See an example" and by mock mode (ARGUABLY_MOCK=1).
// Every quote here appears word for word in the example conversation (SAMPLE_TRANSCRIPT in
// artifact/chat.js), so the example passes its own quote check.
export const sampleVerdict = {
  title: "The 2 a.m. Like",
  participants: [
    {
      name: "Maya",
      name_source: "contact_header",
      evidence: "Contact name 'Maya' at the top of Jordan's screenshots.",
      overall_tone: "Direct, hurt, then sharp",
    },
    {
      name: "Jordan",
      name_source: "contact_header",
      evidence: "Contact name 'Jordan' at the top of Maya's screenshots.",
      overall_tone: "Defensive, answers questions with questions",
    },
  ],
  origin: {
    summary:
      "Maya asked why Jordan was liking another woman's photos at 2 a.m. after saying he was asleep. Instead of answering, Jordan brought up Maya leaving him on read, and it turned into a fight about trust.",
    spark_quote: "So you were 'asleep' but liking Brianna's pics at 2am? 👀",
    spark_speaker: "Maya",
    root_cause:
      "Trust. Maya feels Jordan isn't straight with her about small things. Jordan feels checked up on, so he answers with counter-accusations instead of reassurance.",
    escalation_points: [
      {
        speaker: "Jordan",
        quote: "You literally left me on read for 6 hours yesterday",
        why: "Answered a direct question with a counter-accusation instead of an answer.",
      },
      {
        speaker: "Maya",
        quote: "This is literally the same thing that happened in March",
        why: "Pulled in an old incident, turning one night into a pattern.",
      },
      {
        speaker: "Jordan",
        quote: "Wow ok sorry I'm not perfect like you 🙄",
        why: "Sarcasm that shut the conversation down.",
      },
    ],
  },
  subjects: [
    {
      topic: "The 2 a.m. likes",
      positions: [
        { participant: "Maya", position: "He said he was asleep but was online liking photos. She wants a straight answer.", strength: "strong" },
        { participant: "Jordan", position: "Never answers it. Calls it just a like.", strength: "weak" },
      ],
      edge: "Maya",
    },
    {
      topic: "Being left on read",
      positions: [
        { participant: "Maya", position: "Doesn't respond to it.", strength: "mixed" },
        { participant: "Jordan", position: "Six hours without a reply hurt, and that's fair to raise.", strength: "mixed" },
      ],
      edge: "Even",
    },
    {
      topic: "How they argued",
      positions: [
        { participant: "Maya", position: "Asked a clear question, then escalated with March and 'liar'.", strength: "mixed" },
        { participant: "Jordan", position: "Deflected, minimized, then went sarcastic.", strength: "weak" },
      ],
      edge: "Maya",
    },
  ],
  winner: {
    name: "Maya",
    is_draw: false,
    confidence: 71,
    reasoning:
      "Maya asked a fair, specific question and Jordan never answered it. Being left on read may be a real hurt, but he used it to dodge. Maya loses points for dragging in March and calling him a liar.",
    scores: [
      {
        participant: "Maya",
        score: 72,
        strengths: ["Asked a specific, direct question", "Said what she actually wants: a straight answer"],
        weaknesses: ["Brought up March", "Called him a liar"],
      },
      {
        participant: "Jordan",
        score: 41,
        strengths: ["Being left on read is a fair thing to raise"],
        weaknesses: ["Never answered the question", "Sarcasm ended the conversation"],
      },
    ],
  },
  grudges: [
    {
      holder: "Maya",
      target: "Jordan",
      grudge: "A similar late-night incident back in March.",
      evidence_quote: "This is literally the same thing that happened in March",
      severity: "medium",
    },
  ],
  personal_shots: [
    {
      from: "Jordan",
      to: "Maya",
      quote: "Wow ok sorry I'm not perfect like you 🙄",
      why_its_personal: "Mocks Maya instead of answering her question.",
      severity: "medium",
    },
    {
      from: "Maya",
      to: "Jordan",
      quote: "Honestly you're such a liar",
      why_its_personal: "Labels Jordan as a person instead of naming what he did.",
      severity: "low",
    },
  ],
  fallacies: [
    {
      speaker: "Jordan",
      fallacy: "Tu quoque (whataboutism)",
      quote: "You literally left me on read for 6 hours yesterday",
      explanation: "Maya's late reply doesn't answer why he was liking photos at 2 a.m. It deflects by pointing at her.",
    },
    {
      speaker: "Maya",
      fallacy: "Hasty generalization",
      quote: "This is literally the same thing that happened in March",
      explanation: "One night in March and one night now don't make a pattern on their own.",
    },
    {
      speaker: "Jordan",
      fallacy: "Minimization",
      quote: "It's literally just a like, why is this a whole thing",
      explanation: "Shrinks the question so he doesn't have to answer the part that hurt: saying he was asleep.",
    },
  ],
  takeaway:
    "Jordan: answer the question first, then bring up the read receipts on their own. Maya: leave March out of it. You both want the same thing, which is to feel the other person is being straight with you.",
  safety_note: "",
};
