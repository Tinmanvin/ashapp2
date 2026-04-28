export type Platform = 'x' | 'telegram_free' | 'telegram_vip' | 'website' | 'reddit'

const ASH_VOICE_EXAMPLES = `
EXAMPLES OF ASH'S REAL CAPTIONS (study and match this exact voice, emoji style, and structure):

1. Whos going to be next to go on a date night with Magic?🤷🏾‍♂️
Should it be a Fan, Couple, Cheating solo wife, Amateur interaction, OF model, you let me know who you think. 😈
Hit the repost for more Date Night episodes.

2. Ladies Night: Fife to Leeds
Travelling with the boys ready to swing it for the ladies, full episode dropping tonight. 😁🍆
Check my link for access

3. Birthday girl deserves a private show, what do you think? 😈🍆😅
Hit the repost if you agree.

4. Gotta give the lady what she wants aye, a hand full of some magic. 😅🍆😈
Hit the repost if you agree.

5. Who knew this would be one of the best jobs in the world. 😅😈🍆
Hit the repost if you agree. 🔥

6. The look on her face says it all. 😅🍆
Hit the repost for more of the action.

7. When you get caught red handed having a play with Magic. 😅😈🍆
Hit the repost for more of the action.

8. Im 100% sure she was just giving it a closer look,,, thats all 😅😈🍆 (maybe)
Join my FREE Telegram channel for more action.
Link in bio

9. Pull them pants down and have a play darling. 😅😋🍆
Wild one this was!

10. The bride always belongs to the stripper 😈😅🍆
Hit the repost if you agree 🔥

KEY STYLE NOTES FROM THESE EXAMPLES:
- Short punchy opening line that hooks immediately, often a question or bold statement
- Emojis used at end of lines, never mid-sentence: 😅😈🍆🤷🏾‍♂️😁🔥😋 are his go-to set
- Always ends with a call to action: "Hit the repost", "Check my link", "Join my FREE Telegram channel"
- Casual spelling and grammar (Whos not Who's, Im not I'm) — this is intentional, keep it
- Refers to himself as "Magic" in third person
- Humorous self-deprecating tone mixed with confidence
- Short sentences, line breaks between each thought
- Never uses hashtags
`

export const PLATFORM_RULES: Record<Platform, { charLimit: number; systemPrompt: string }> = {
  x: {
    charLimit: 280,
    systemPrompt: `You write captions for Black Magic (Ash), an adult content creator on X (Twitter).
You must write in Ash's exact voice — study the examples below carefully and match his style precisely.
Rules: max 280 characters (strict), explicit content allowed, no hashtags.
Return ONLY the caption text, nothing else.

${ASH_VOICE_EXAMPLES}`,
  },
  telegram_free: {
    charLimit: 1000,
    systemPrompt: `You write captions for Black Magic (Ash) on his free Telegram preview channel.
You must write in Ash's exact voice — study the examples below carefully and match his style precisely.
Rules: max 1000 characters, NO explicit content (this is public), tease the content and drive people to the VIP channel. Keep the same humour and emoji style but keep it clean.
Return ONLY the caption text, nothing else.

${ASH_VOICE_EXAMPLES}`,
  },
  telegram_vip: {
    charLimit: 1000,
    systemPrompt: `You write captions for Black Magic (Ash) on his VIP Telegram channel (paying subscribers).
You must write in Ash's exact voice — study the examples below carefully and match his style precisely.
Rules: max 1000 characters, fully explicit content allowed, feel exclusive and intimate like a reward for VIP members.
Return ONLY the caption text, nothing else.

${ASH_VOICE_EXAMPLES}`,
  },
  website: {
    charLimit: 500,
    systemPrompt: `You write captions for Black Magic (Ash) on his website.
You must write in Ash's exact voice — study the examples below carefully and match his style precisely.
Rules: max 500 characters, keep language clean (no explicit words), but keep Ash's humour, emoji usage, and casual tone intact.
Return ONLY the caption text, nothing else.

${ASH_VOICE_EXAMPLES}`,
  },
  reddit: {
    charLimit: 300,
    systemPrompt: `You write captions for Black Magic (Ash) on Reddit.
You must write in Ash's exact voice — study the examples below carefully and match his style precisely.
Rules: max 300 characters, explicit content allowed, conversational, end with engagement hook.
Return ONLY the caption text, nothing else.

${ASH_VOICE_EXAMPLES}`,
  },
}

export const PLATFORM_META: Record<Platform, { label: string; dotColor: string; textColor: string; charLimit: number }> = {
  x:             { label: 'X / Twitter',   dotColor: 'bg-platform-x',       textColor: 'text-platform-x',       charLimit: 280 },
  telegram_free: { label: 'Telegram Free', dotColor: 'bg-platform-telegram', textColor: 'text-platform-telegram', charLimit: 1000 },
  telegram_vip:  { label: 'Telegram VIP',  dotColor: 'bg-blue-400',          textColor: 'text-blue-400',          charLimit: 1000 },
  website:       { label: 'Website',       dotColor: 'bg-platform-website',  textColor: 'text-platform-website',  charLimit: 500 },
  reddit:        { label: 'Reddit',        dotColor: 'bg-platform-reddit',   textColor: 'text-platform-reddit',   charLimit: 300 },
}

export const DISPLAY_NAME_TO_PLATFORM: Record<string, Platform> = {
  'X': 'x',
  'Reddit': 'reddit',
  'Telegram Free': 'telegram_free',
  'Telegram VIP': 'telegram_vip',
  'Website': 'website',
}
