export const EMOJI_PAGE_SIZE = 42

const PACK = [
    "😀😃😄😁😆😅🤣😂🙂🙃😉😊😇🥰😍🤩😘😗☺️😚😙🥲😋😛😜🤪😝🤑🤗🤭🫢🫣🤫🤔🫡🤐🤨😐😑😶🫥😏😒🙄😬🤥😌😔😪🤤😴😷🤒🤕🤢🤮🤧🥵🥶🥴😵🤯🤠🥳🥸😎🤓🧐",
    "😕😟🙁☹️😮😯😲😳🥺😦😧😨😰😥😢😭😱😖😣😞😓😩😫🥱😤😡😠🤬😈👿💀☠️💩🤡👹👺👻👽👾🤖😺😸😹😻😼😽🙀😿😾",
    "🙈🙉🙊💋💌💘💝💖💗💓💞💕💟❣️💔❤️‍🔥❤️‍🩹❤️🧡💛💚💙💜🤎🖤🤍💯💢💥💫💦💨🕳️💣💬👁️‍🗨️🗨️🗯️💭💤",
    "👋🤚🖐️✋🖖👌🤌🤏✌️🤞🫰🤟🤘🤙👈👉👆🖕👇☝️🫵👍👎✊👊🤛🤜👏🙌🫶👐🤲🤝🙏✍️💅🤳💪🦾🦿🦵🦶👂🦻👃🧠🫀🫁🦷🦴👀👁️👅👄",
    "🐶🐱🐭🐹🐰🦊🐻🐼🐻‍❄️🐨🐯🦁🐮🐷🐽🐸🐵🙈🙉🙈🐒🐔🐧🐦🐤🐣🐥🦆🦅🦉🦇🐺🐗🐴🦄🐝🪱🐛🦋🐌🐞🐜🪰🪲🪳🦟🦗🕷️🕸️🦂🐢🐍🦎🦖🦕🐙🦑🦐🦞🦀🐡🐠🐟🐬🐳🐋🦈🐊🐅🐆🦓🦍🦧🦣🐘🦛🦏🐪🐫🦒🦘🦬🐃🐂🐄🐎🐖🐏🐑🦙🐐🦌🐕🐩🦮🐕‍🦺🐈🐈‍⬛🪶🐓🦃🦤🦚🦜🦢🪿🦩🕊️🐇🦝🦨🦡🦫🦦🦥🐁🐀🐿️🦔",
    "🍏🍎🍐🍊🍋🍌🍉🍇🍓🫐🍈🍒🍑🥭🍍🥥🥝🍅🍆🥑🫛🥦🥬🥒🌶️🫑🌽🥕🫒🧄🧅🥔🍠🫚🥐🥯🍞🥖🥨🧀🥚🍳🧈🥞🧇🥓🥩🍗🍖🦴🌭🍔🍟🍕🫓🥪🥙🧆🌮🌯🫔🥗🥘🫕🥫🍝🍜🍲🍛🍣🍱🥟🦪🍤🍙🍚🍘🍥🥠🥮🍢🍡🍧🍨🍦🥧🧁🍰🎂🍮🍭🍬🍫🍿🍩🍪🌰🥜🫘🍯🍼🥛☕🫖🍵🍶🍾🍷🍸🍹🍺🍻🥂🥃🥤🧋🧃🧉🧊",
    "⚽🏀🏈⚾🥎🎾🏐🏉🥏🎱🪀🏓🏸🏒🏑🥍🏏🪃🥅⛳🪁🏹🎣🤿🥊🥋🎽🛹🛼🛷⛸️🥌🎿⛷️🏂🪂🏋️🤼🤸⛹️🤺🤾🏌️🏇🧘🏄🏊🤽🚣🧗🚴🚵🎽🏆🥇🥈🥉🏅🎖️🏵️🎗️🎫🎟️🎪🤹🎭🩰🎨🎬🎤🎧🎼🎹🥁🪘🎷🎺🪗🎸🪕🎻🪈🎲♟️🎯🎳🎮🎰🧩",
    "🚗🚕🚙🚌🚎🏎️🚓🚑🚒🚐🛻🚚🚛🚜🦯🦽🦼🛴🚲🛵🏍️🛺🚨🚔🚍🚘🚖🚡🚠🚟🚃🚋🚞🚝🚄🚅🚈🚂🚆🚇🚊🚉✈️🛫🛬🛩️💺🛰️🚀🛸🚁🛶⛵🚤🛥️🛳️⛴️🚢⚓🪝⛽🚧🚦🚥🚏🗺️🗿🗽🗼🏰",
    "⌚📱📲💻⌨️🖥️🖨️🖱️🖲️🕹️🗜️💽💾💿📀📼📷📸📹🎥📽️🎞️📞☎️📟📠📺📻🎙️🎚️🎛️🧭⏱️⏲️⏰🕰️⌛⏳📡🔋🪫🔌💡🔦🕯️🪔🧯🛢️💸💵💴💶💷🪙💰💳🧾",
    "✉️📧📨📩📤📥📦📫📪📬📭📮📝📁📂🗂️📅📆🗒️🗓️📇📈📉📊📋📌📍📎🖇️📏📐✂️🗃️🗄️🗑️🔒🔓🔏🔐🔑🗝️🔨🪓⛏️⚒️🛠️🗡️⚔️🔫🪃🏹🛡️🪚🔧🪛🔩⚙️🗜️⚖️🦯🔗⛓️🪝🧰🧲🪜",
    "❤️🧡💛💚💙💜🖤🤍🤎💔❣️💕💞💓💗💖💘💝💟☮️✝️☪️🕉️☸️✡️🔯🕎☯️☦️🛐⛎♈♉♊♋♌♍♎♏♐♑♒♓🆔⚛️🉑☢️☣️📴📳🈶🈚🈸🈺🈷️✴️🆚💮🉐㊙️㊗️🈴🈵🈹🈲🅰️🅱️🆎🆑🅾️🆘❌⭕🛑⛔📛🚫💯♨️🚷🚯🚳🚱🔞📵🚭",
    "‼️⁉️❓❔❕❗〽️⚠️🚸🔅🔆🔱⚜️〰️💱💲⚕️♻️🈯💹❇️✳️❎🌐💠Ⓜ️🌀💤🏧🚾♿🅿️🛗🈳🈂️🛂🛃🛄🛅🚹🚺🚼⚧️🚻🚮🎦📶🈁🔣ℹ️🔤🔡🔠🆖🆗🆙🆒🆕🆓0️⃣1️⃣2️⃣3️⃣4️⃣5️⃣6️⃣7️⃣8️⃣9️⃣🔟",
    "🔴🟠🟡🟢🔵🟣⚫⚪🟤🔺🔻💠🔘🔳🔲▪️▫️◾◽◼️◻️🟥🟧🟨🟩🟦🟪⬛⬜🟫🔶🔷🔸🔹🔺🔻💬👁️‍🗨️🗨️🗯️💭🕐🕑🕒🕓🕔🕕🕖🕗🕘🕙🕚🕛"
].join("")

let cached: readonly string[] | null = null

function segmentGraphemes(s: string): readonly string[] {
    if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
        const seg = new Intl.Segmenter("ru", { granularity: "grapheme" })
        return Array.from(seg.segment(s), (x) => x.segment)
    }
    return Array.from(s)
}

export function getChatEmojiList(): readonly string[] {
    if (cached) return cached
    const uniq = new Set(segmentGraphemes(PACK))
    cached = Array.from(uniq)
    return cached
}

export function getEmojiPageCount(pageSize: number = EMOJI_PAGE_SIZE): number {
    const n = getChatEmojiList().length
    return Math.max(1, Math.ceil(n / pageSize))
}

export function getEmojiPage(pageIndex: number, pageSize: number = EMOJI_PAGE_SIZE): readonly string[] {
    const all = getChatEmojiList()
    const start = pageIndex * pageSize
    return all.slice(start, start + pageSize)
}
