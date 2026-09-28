# The UX Anti-Pattern Catalog

This catalog documents manipulative and harmful design patterns. Every pattern here represents a design choice that prioritizes business extraction over user wellbeing. The Intent system treats these as defects, not features.

Severity levels:
- **Critical** — Causes direct, measurable harm. Likely violates regulations. Must be remediated immediately.
- **High** — Causes significant user harm or violates user trust. Regulatory risk. Requires prompt remediation.
- **Medium** — Degrades user experience or erodes trust over time.
- **Low** — Minor friction or annoyance.

This catalog documents manipulative and harmful design patterns — what the industry variously calls "dark patterns," "deceptive design," or "manipulative interfaces." Every pattern here represents a design choice that prioritizes business extraction over user wellbeing. The Intent system treats these as defects, not features.

Severity levels:
- **Critical** — Causes direct, measurable harm. Likely violates regulations. Must be remediated immediately.
- **High** — Causes significant user harm or violates user trust. Regulatory risk. Requires prompt remediation.
- **Medium** — Degrades user experience or erodes trust over time. Should be remediated in normal course.
- **Low** — Minor friction or annoyance. Technically not harmful but signals disregard for user experience.

### Category 1: Deceptive Patterns

Designs that trick users into actions they didn't intend.

| Pattern | What it does | Severity |
|---------|-------------|----------|
| **Bait and Switch** | Offers one thing, delivers another. User clicks expecting X, gets Y. | Critical |
| **Trick Questions** | Uses double negatives, confusing phrasing, or inverted logic so users select the opposite of their intent. | Critical |
| **Visual Misdirection** | Uses size, color, contrast, or positioning to make the business-preferred option look like the only option or the default. | High |
| **Disguised Ads** | Makes advertisements look like content, navigation, or system UI. | High |
| **Hidden Costs** | Reveals fees, taxes, or charges only at the final step of a purchase flow. | Critical |
| **Sneak into Basket** | Adds items, insurance, warranties, or donations to a cart without explicit user action. | Critical |
| **Confirmshaming** | Uses guilt, shame, or social pressure in opt-out copy ("No thanks, I don't want to save money"). | High |

### Category 2: Prechecked & Default Manipulation

Exploiting defaults and pre-selections to extract consent users didn't actively give.

| Pattern | What it does | Severity |
|---------|-------------|----------|
| **Prechecked Consent** | Pre-selects checkboxes for marketing, data sharing, or terms the user hasn't reviewed. | Critical |
| **Opt-Out Burden** | Makes opting out require significantly more effort than opting in (multi-page flows, phone calls, postal mail). | Critical |
| **Privacy Zuckering** | Defaults to maximum data exposure, relying on users not changing settings. Named after Facebook's repeated defaults. | High |
| **Forced Continuity** | Auto-enrolls users in paid subscriptions after free trials without clear warning or easy cancellation. | Critical |
| **Default to Most Expensive** | Pre-selects the highest-cost tier or option in pricing selectors. | Medium |

### Category 3: Urgency & Scarcity Fabrication

Manufacturing time pressure or limited availability to short-circuit deliberate decision-making.

| Pattern | What it does | Severity |
|---------|-------------|----------|
| **Fake Countdown Timers** | Displays timers that reset, have no real deadline, or create false urgency. | Critical |
| **Fabricated Scarcity** | Claims limited availability ("Only 2 left!") that doesn't reflect actual inventory. | Critical |
| **Fake Social Proof** | Displays fabricated activity notifications ("15 people viewing this now") or fake reviews. | Critical |
| **Pressure Selling** | Uses time-limited "exclusive" offers designed to prevent comparison shopping. | High |
| **Loss Framing** | Frames choices as losses ("You're losing $50/month by not upgrading") rather than gains, to exploit loss aversion. | Medium |

### Category 4: Addictive Design

Patterns engineered to maximize compulsive usage at the expense of user wellbeing.

| Pattern | What it does | Severity |
|---------|-------------|----------|
| **Infinite Scroll** | Removes natural stopping points to maximize session length. No pagination, no "end," no sense of completion. | Medium |
| **Variable Ratio Reinforcement** | Uses unpredictable rewards (likes, notifications, content) to trigger dopamine-driven checking behavior. Slot machine mechanics. | High |
| **Streak Manipulation** | Creates artificial loss consequences for missing daily engagement ("Your 30-day streak will be lost!"). | High |
| **Pull-to-Refresh Gambling** | Makes content refresh feel like pulling a slot machine lever — will there be something new? | Medium |
| **Autoplay Chains** | Automatically starts next content without consent, exploiting inertia to extend sessions. | Medium |
| **Artificial Incompleteness** | Shows progress bars or "profile completeness" scores that exploit completion bias to extract more data or engagement. | Medium |

### Category 5: Attention Exploitation

Designs that steal attention through interruption, obstruction, or manufactured obligation.

| Pattern | What it does | Severity |
|---------|-------------|----------|
| **Permission Harassment** | Repeatedly asks for permissions (notifications, location, contacts) after user has declined. | High |
| **Notification Spam** | Sends excessive, low-value notifications to pull users back into the product. | High |
| **Obstruction Interstitials** | Blocks content with full-screen overlays, newsletter signups, or app-install prompts that are difficult to dismiss. | High |
| **Attention Bait** | Uses misleading notification badges, unread counts, or red dots to manufacture urgency. | Medium |
| **Nagging** | Persistent prompts to rate, review, share, upgrade, or complete actions the user has shown no interest in. | Medium |

### Category 6: Accessibility Weaponized

Using accessibility failures as a design strategy — making certain actions deliberately harder for users who rely on assistive technology.

| Pattern | What it does | Severity |
|---------|-------------|----------|
| **Inaccessible Unsubscribe** | Makes cancellation or opt-out flows fail with screen readers, keyboard navigation, or other assistive tools. | Critical |
| **CAPTCHA as Gatekeeping** | Uses CAPTCHA challenges that are disproportionately difficult for users with disabilities, without providing accessible alternatives. | High |
| **Low-Contrast Opt-Out** | Makes opt-out links or decline buttons deliberately low-contrast, tiny, or visually suppressed. | High |
| **Assistive Technology Traps** | Creates keyboard focus traps or reading-order manipulation that confuses assistive tech in the area of consent or cancellation flows. | Critical |

### Category 7: Vulnerable User Exploitation

Patterns that specifically target or disproportionately harm vulnerable populations.

| Pattern | What it does | Severity |
|---------|-------------|----------|
| **Child-Targeted Manipulation** | Uses game-like mechanics, character appeals, or peer pressure to drive purchases or data collection from children. | Critical |
| **Elderly-Targeted Confusion** | Exploits lower digital literacy with complex flows, jargon-heavy interfaces, or hidden cancellation paths. | Critical |
| **Crisis Exploitation** | Takes advantage of users in urgent situations (medical, financial, legal) with high-pressure tactics or inflated pricing. | Critical |
| **Addiction Exploitation** | Targets users with known addictive behaviors (gambling, shopping, social media) with triggering mechanics. | Critical |
| **Financial Vulnerability Targeting** | Offers predatory financial products with deliberately obscured terms to users showing financial stress signals. | Critical |

### Category 8: AI-Specific Dark Patterns

Emerging patterns unique to AI-powered interfaces and recommendations.

| Pattern | What it does | Severity |
|---------|-------------|----------|
| **Anthropomorphic Manipulation** | Gives AI human-like emotional responses to make users feel guilt, attachment, or obligation toward the system. | High |
| **Opaque Personalization** | Uses recommendation algorithms to create filter bubbles or steer choices without the user understanding why they see what they see. | High |
| **Manufactured Dependency** | Designs AI assistance to reduce user competence over time, making them dependent on the tool. | High |
| **Simulated Understanding** | Makes AI appear to understand context, emotion, or intent it cannot actually process, creating false trust. | Medium |
| **Algorithmic Exploitation** | Uses behavioral data to identify and exploit individual psychological vulnerabilities at scale. | Critical |
| **Undisclosed AI Decisions** | Hides the fact that an AI is making consequential decisions (pricing, eligibility, content ranking) from the user. | High |

### Category 9: Common UX Failures

Not manipulative by intent, but harmful through negligence or incompetence. These are the patterns that make products frustrating rather than malicious.

| Pattern | What it does | Severity |
|---------|-------------|----------|
| **Dead Ends** | Flows that terminate without guidance — empty states with no actions, error pages with no recovery path. | Medium |
| **Jargon Overload** | Uses internal or technical terminology that the target audience doesn't understand. | Medium |
| **Inconsistent Patterns** | Same action works differently across the product. Delete here, remove there, cancel somewhere else. | Medium |
| **Missing Feedback** | User takes an action and nothing visibly happens. Did it work? Did it fail? Nobody knows. | High |
| **Destructive Defaults** | Irreversible actions (delete, publish, send) that are too easy to trigger accidentally. | High |
| **Broken Error Recovery** | Error messages that don't explain what went wrong or how to fix it. "An error occurred." | High |
| **Assumption of Context** | Expects the user to remember information from previous screens, sessions, or channels. | Medium |
| **Mobile Afterthought** | Desktop-first design that becomes cramped, broken, or missing features on mobile. | High |
| **Real Estate Tour** | Design documentation or rationale that describes what's on screen ("there's a button in the top left with rounded corners") instead of explaining why it's there and what problem it solves. Inventory masquerading as intent. | Medium |

### Category 10: Narrative Pathologies in Design Process

Designs and design *processes* that fool the team about user reality. Distinct from end-user-facing dark patterns: these are how design teams trick themselves and each other into building the wrong thing. Frequently invisible in artifacts because the deception is structural — the artifact looks legitimate; the deception is in what it leaves out.

| Pattern | What it does | Severity |
|---------|-------------|----------|
| **Smoothed-arc Personas** | Constructs a single user narrative arc that smooths over real variance in research. The persona reads coherently when the underlying data showed three or more distinct, non-converging user paths. The team empathizes with a fictional composite, not actual users. | High |
| **Manufactured-Tension Briefs** | Strategic narratives whose complication is sized to fit a predetermined resolution rather than what evidence shows. Symptom: the tension feels conveniently shaped. Result: teams commit to strategies built on inflated or invented problems. | High |
| **Conflict-Default Journeys** | Frames every user experience as a hero's journey with a goal, obstacle, and resolution — even when the actual experience is habit-shaped, ambient, or recurring. Forces conflict structure onto experiences that don't have it, distorting the design. | Medium |
| **Story-as-Evidence Substitution** | Uses narrative emotional appeal to win stakeholder assent for design decisions that aren't supported by research. The story carries the conviction; the evidence is post-hoc or absent. | High |
| **Choreography Role-Reduction** | Service blueprints that flatten humans into system roles. The blueprint reads cleanly because nobody is in it — the customer, the agent, the system are all abstractions. Coordination clarity purchased by erasing the people the service exists for. | Medium |

### Regulatory Context

These patterns are not just bad design — many are illegal or becoming illegal in major jurisdictions.

**EU / GDPR (General Data Protection Regulation)**
- Prechecked consent boxes are explicitly prohibited (Article 7, Recital 32)
- Consent must be freely given, specific, informed, and unambiguous
- Withdrawal of consent must be as easy as giving it
- Dark patterns in cookie consent interfaces are under active enforcement

**California (CPRA / Automated Decision-Making)**
- Right to opt out of sale/sharing of personal information
- Symmetry requirement: opt-out must be as easy as opt-in
- Businesses cannot use dark patterns to subvert consumer rights

**FTC (Federal Trade Commission, United States)**
- Active enforcement against deceptive design practices
- Fortnite settlement (2022): $520M for dark patterns targeting children
- Focus on negative option practices (subscriptions, auto-renewals)
- "Click to cancel" rule requiring cancellation as easy as enrollment

**COPPA (Children's Online Privacy Protection Act)**
- Strict limits on data collection from children under 13
- Verifiable parental consent required
- No behavioral advertising targeting children

**EU Digital Services Act (DSA)**
- Explicitly prohibits dark patterns on online platforms
- Bans interfaces that deceive, manipulate, or materially distort user decisions
- Specific protections for minors
- Mandates transparency in recommendation systems
