// A canned verdict used by "See an example" and by mock mode (ARGUABLY_MOCK=1).
export const sampleVerdict = {
  title: "The Great Dishwasher Standoff",
  participants: [
    {
      name: "Maya",
      name_source: "contact_header",
      evidence: "Contact name 'Maya 🌻' at the top of screenshots 1 and 2.",
      overall_tone: "Specific, frustrated, mostly on-topic",
    },
    {
      name: "Jordan",
      name_source: "contact_header",
      evidence: "Contact name 'Jordan' at the top of screenshot 3.",
      overall_tone: "Defensive, deflects with sarcasm",
    },
  ],
  origin: {
    summary:
      "Maya asked why the dishes were still in the sink after Jordan said they'd handle them. It quickly became an argument about who does more around the apartment.",
    spark_quote: "You said you'd do the dishes last night?",
    spark_speaker: "Maya",
    root_cause:
      "Maya feels the chore split is uneven and that Jordan's promises don't get followed through. The dishes are the surface; reliability is the real issue.",
    escalation_points: [
      {
        speaker: "Jordan",
        quote: "Ok and you left your laundry in the dryer for 3 days so",
        why: "Answered a question about the dishes with a counter-accusation instead of the dishes.",
      },
      {
        speaker: "Maya",
        quote: "This is literally the same thing that happened in March",
        why: "Pulled a past incident in, widening the fight from one night to a pattern.",
      },
      {
        speaker: "Jordan",
        quote: "Wow ok sorry I'm not perfect like you",
        why: "Sarcasm that shut the conversation down instead of answering.",
      },
    ],
  },
  subjects: [
    {
      topic: "The unwashed dishes",
      positions: [
        { participant: "Maya", position: "Jordan agreed to do them and didn't.", strength: "strong" },
        { participant: "Jordan", position: "Was going to do them today; it's not a big deal.", strength: "weak" },
      ],
      edge: "Maya",
    },
    {
      topic: "Overall chore split",
      positions: [
        { participant: "Maya", position: "She does most of the cleaning and is tired of reminding.", strength: "mixed" },
        { participant: "Jordan", position: "Maya leaves things around too (the laundry).", strength: "mixed" },
      ],
      edge: "Even",
    },
    {
      topic: "How to talk about it",
      positions: [
        { participant: "Maya", position: "Wants to set up a proper chore chart.", strength: "strong" },
        { participant: "Jordan", position: "Feels nagged and wants her to drop it.", strength: "weak" },
      ],
      edge: "Maya",
    },
  ],
  winner: {
    name: "Maya",
    is_draw: false,
    confidence: 74,
    reasoning:
      "Maya stayed on the actual issue, pointed to a specific broken promise, and proposed a fix. Jordan's laundry point is fair, but it was used to dodge rather than to negotiate. Maya loses points for dragging in March.",
    scores: [
      {
        participant: "Maya",
        score: 72,
        strengths: ["Specific, verifiable complaint", "Proposed a solution (chore chart)"],
        weaknesses: ["Brought up March", "'You always' generalization"],
      },
      {
        participant: "Jordan",
        score: 41,
        strengths: ["Laundry point is a fair observation"],
        weaknesses: ["Deflected instead of answering", "Sarcasm ended the discussion"],
      },
    ],
  },
  grudges: [
    {
      holder: "Maya",
      target: "Jordan",
      grudge: "A similar broken promise about cleaning in March.",
      evidence_quote: "This is literally the same thing that happened in March",
      severity: "medium",
    },
  ],
  personal_shots: [
    {
      from: "Jordan",
      to: "Maya",
      quote: "Wow ok sorry I'm not perfect like you",
      why_its_personal: "Mocks Maya's character instead of addressing the dishes.",
      severity: "medium",
    },
    {
      from: "Maya",
      to: "Jordan",
      quote: "You always do this, you're so unreliable",
      why_its_personal: "Labels Jordan as a person rather than naming the behaviour.",
      severity: "low",
    },
  ],
  fallacies: [
    {
      speaker: "Jordan",
      fallacy: "Tu quoque (whataboutism)",
      quote: "Ok and you left your laundry in the dryer for 3 days so",
      explanation: "Maya's laundry doesn't make the dishes promise any less broken; it deflects by pointing at her.",
    },
    {
      speaker: "Maya",
      fallacy: "Hasty generalization",
      quote: "You always do this, you're so unreliable",
      explanation: "One missed night and one incident in March don't make 'always'.",
    },
    {
      speaker: "Jordan",
      fallacy: "Minimization",
      quote: "It's literally just dishes, why is this a whole thing",
      explanation: "Shrinks the issue to avoid the underlying complaint about follow-through.",
    },
  ],
  takeaway:
    "Jordan: own the dishes without the 'but'. Maya: drop 'always' and March. Then actually make the chore chart; you both already agree the split feels off.",
  safety_note: "",
};
