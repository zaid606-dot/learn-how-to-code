// JSON schema for the verdict Claude returns. Used as a structured-output
// format, so every object lists all of its keys in `required` and sets
// `additionalProperties: false`. Numeric ranges live in descriptions because
// structured outputs don't enforce minimum/maximum.

const str = (description) => ({ type: "string", description });
const int = (description) => ({ type: "integer", description });
const bool = (description) => ({ type: "boolean", description });
const enumOf = (values, description) => ({ type: "string", enum: values, description });
const arr = (items, description) => ({ type: "array", items, description });
const obj = (properties, description) => ({
  type: "object",
  description,
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

const severity = enumOf(["low", "medium", "high"], "How much this hurts the conversation.");

export const verdictSchema = obj({
  title: str("A punchy 3-8 word headline for this argument, e.g. 'The 2 a.m. Like'."),
  participants: arr(
    obj({
      name: str("Name exactly as shown in the screenshots, or a bubble label like 'Blue bubbles' if no name is visible."),
      name_source: enumOf(
        ["contact_header", "signed_or_self_named", "mentioned_by_other", "bubble_side_only"],
        "Where the name came from."
      ),
      evidence: str("Short quote or description of where in the screenshot the name appears."),
      overall_tone: str("One short phrase describing how this person argues, e.g. 'calm but dismissive'."),
    }),
    "Everyone who sends messages in the conversation, plus anyone important who is mentioned."
  ),
  origin: obj({
    summary: str("2-3 sentences: what the argument is about and where it is coming from."),
    spark_quote: str("The exact message that kicked the argument off."),
    spark_speaker: str("Who sent the spark message."),
    root_cause: str("The underlying issue the argument is really sprouting from (often different from the surface topic)."),
    escalation_points: arr(
      obj({
        speaker: str("Who escalated."),
        quote: str("Exact message text."),
        why: str("Why this moment turned up the heat."),
      }),
      "Moments where things escalated, in chronological order."
    ),
  }),
  subjects: arr(
    obj({
      topic: str("A main subject being argued about."),
      positions: arr(
        obj({
          participant: str("Participant name."),
          position: str("Their stance on this topic in one or two sentences."),
          strength: enumOf(["strong", "mixed", "weak"], "How well this stance is supported by what they actually said."),
        }),
        "Each participant's position on this topic."
      ),
      edge: str("Participant name who has the better case on this topic, or 'Even'."),
    }),
    "The main subjects argued about, compared side by side."
  ),
  winner: obj({
    name: str("Winning participant's name. Always one person, never a draw."),
    is_draw: bool("Always false, unless there is a safety_note (then true, with no winner)."),
    confidence: int("0-100: how confident the verdict is."),
    reasoning: str("2-4 sentences: why the winner won, what tipped it, and what the other side needed to do differently. Grounded in the messages."),
    scores: arr(
      obj({
        participant: str("Participant name."),
        score: int("0-100 overall argument score. The winner's is the highest, at least 3 points clear."),
        strengths: arr(str("A strength, short phrase."), "What they did well."),
        weaknesses: arr(str("A weakness, short phrase."), "What hurt their case."),
      }),
      "One entry per participant who sent messages."
    ),
  }),
  grudges: arr(
    obj({
      holder: str("Who is holding the grudge."),
      target: str("Who it is aimed at."),
      grudge: str("What old issue is being carried into this argument."),
      evidence_quote: str("Exact message text that reveals it."),
      severity,
    }),
    "Old resentments or past incidents dragged into this argument. Empty if none."
  ),
  personal_shots: arr(
    obj({
      from: str("Who took the shot."),
      to: str("Who it was aimed at."),
      quote: str("Exact message text."),
      why_its_personal: str("Why this attacks the person rather than the point."),
      severity,
    }),
    "Insults, digs, or attacks on character instead of the issue. Empty if none."
  ),
  fallacies: arr(
    obj({
      speaker: str("Who committed it."),
      fallacy: str("Name of the logical fallacy, e.g. 'Straw man', 'Whataboutism', 'Ad hominem'."),
      quote: str("Exact message text."),
      explanation: str("Plain-English explanation of why this is that fallacy here."),
    }),
    "Logical fallacies found in the messages. Empty if none."
  ),
  takeaway: str("1-3 encouraging sentences with concrete next steps for resolving this, without blame."),
  safety_note: str(
    "If the messages show threats, coercion, stalking, or abuse, a brief caring note suggesting support resources. Otherwise an empty string."
  ),
});
