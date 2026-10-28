// Sélection compacte d'emojis Unicode courants (pas de base complète : légèreté).
// Le rendu utilise la police emoji du système.

export interface UnicodeEmoji {
  char: string;
  names: string[];
}

const RAW: [string, string][] = [
  ["😀", "grinning"], ["😃", "smiley"], ["😄", "smile"], ["😁", "grin"], ["😆", "laughing satisfied"],
  ["😅", "sweat_smile"], ["🤣", "rofl rolling_on_the_floor_laughing"], ["😂", "joy"], ["🙂", "slight_smile"],
  ["🙃", "upside_down"], ["😉", "wink"], ["😊", "blush"], ["😇", "innocent"], ["🥰", "smiling_face_with_3_hearts"],
  ["😍", "heart_eyes"], ["🤩", "star_struck"], ["😘", "kissing_heart"], ["😋", "yum"], ["😛", "stuck_out_tongue"],
  ["😜", "stuck_out_tongue_winking_eye"], ["🤪", "zany_face"], ["🤔", "thinking"], ["🤨", "face_with_raised_eyebrow"],
  ["😐", "neutral_face"], ["😑", "expressionless"], ["😶", "no_mouth"], ["🙄", "rolling_eyes"], ["😏", "smirk"],
  ["😬", "grimacing"], ["😌", "relieved"], ["😔", "pensive"], ["😪", "sleepy"], ["😴", "sleeping"], ["😷", "mask"],
  ["🤒", "thermometer_face"], ["🤢", "nauseated_face"], ["🤮", "vomiting"], ["🥵", "hot_face"], ["🥶", "cold_face"],
  ["😵", "dizzy_face"], ["🤯", "exploding_head"], ["🥳", "partying_face"], ["😎", "sunglasses"], ["🤓", "nerd"],
  ["🧐", "monocle_face"], ["😕", "confused"], ["😟", "worried"], ["🙁", "slight_frown"], ["😮", "open_mouth"],
  ["😲", "astonished"], ["😳", "flushed"], ["🥺", "pleading_face"], ["😦", "frowning"], ["😧", "anguished"],
  ["😨", "fearful"], ["😰", "cold_sweat"], ["😢", "cry"], ["😭", "sob"], ["😱", "scream"], ["😖", "confounded"],
  ["😣", "persevere"], ["😞", "disappointed"], ["😓", "sweat"], ["😩", "weary"], ["😫", "tired_face"],
  ["🥱", "yawning_face"], ["😤", "triumph"], ["😡", "rage"], ["😠", "angry"], ["🤬", "face_with_symbols_over_mouth"],
  ["😈", "smiling_imp"], ["💀", "skull"], ["💩", "poop"], ["🤡", "clown"], ["👻", "ghost"], ["👽", "alien"],
  ["🤖", "robot"], ["😺", "smiley_cat"], ["🙈", "see_no_evil"], ["🙉", "hear_no_evil"], ["🙊", "speak_no_evil"],
  ["👋", "wave"], ["🤚", "raised_back_of_hand"], ["✋", "raised_hand"], ["👌", "ok_hand"], ["🤌", "pinched_fingers"],
  ["✌️", "v"], ["🤞", "fingers_crossed"], ["🤟", "love_you_gesture"], ["🤘", "metal"], ["👈", "point_left"],
  ["👉", "point_right"], ["👆", "point_up_2"], ["👇", "point_down"], ["👍", "thumbsup +1"], ["👎", "thumbsdown -1"],
  ["✊", "fist"], ["👊", "punch"], ["👏", "clap"], ["🙌", "raised_hands"], ["🤝", "handshake"], ["🙏", "pray"],
  ["💪", "muscle"], ["🫡", "saluting_face"], ["👀", "eyes"], ["🧠", "brain"], ["❤️", "heart"], ["🧡", "orange_heart"],
  ["💛", "yellow_heart"], ["💚", "green_heart"], ["💙", "blue_heart"], ["💜", "purple_heart"], ["🖤", "black_heart"],
  ["🤍", "white_heart"], ["💔", "broken_heart"], ["💕", "two_hearts"], ["💯", "100"], ["💢", "anger"],
  ["💥", "boom"], ["💫", "dizzy"], ["💦", "sweat_drops"], ["💤", "zzz"], ["🔥", "fire"], ["✨", "sparkles"],
  ["⭐", "star"], ["🌟", "star2"], ["⚡", "zap"], ["🎉", "tada"], ["🎊", "confetti_ball"], ["🎁", "gift"],
  ["🏆", "trophy"], ["🥇", "first_place"], ["⚽", "soccer"], ["🎮", "video_game"], ["🎵", "musical_note"],
  ["🎶", "notes"], ["☕", "coffee"], ["🍺", "beer"], ["🍻", "beers"], ["🍕", "pizza"], ["🍔", "hamburger"],
  ["🍟", "fries"], ["🍿", "popcorn"], ["🍰", "cake"], ["🍪", "cookie"], ["🌈", "rainbow"], ["☀️", "sunny"],
  ["🌙", "crescent_moon"], ["🚀", "rocket"], ["💻", "computer"], ["📱", "iphone mobile_phone"], ["📌", "pushpin"],
  ["📎", "paperclip"], ["🔗", "link"], ["🔒", "lock"], ["🔑", "key"], ["⏰", "alarm_clock"], ["✅", "white_check_mark"],
  ["☑️", "ballot_box_with_check"], ["✔️", "heavy_check_mark"], ["❌", "x"], ["❎", "negative_squared_cross_mark"],
  ["⚠️", "warning"], ["⛔", "no_entry"], ["🚫", "no_entry_sign"], ["❓", "question"], ["❗", "exclamation"],
  ["‼️", "bangbang"], ["⁉️", "interrobang"], ["➕", "heavy_plus_sign"], ["➖", "heavy_minus_sign"],
  ["🆗", "ok"], ["🆕", "new"], ["🆒", "cool"], ["🇫🇷", "flag_fr"], ["🏳️‍🌈", "rainbow_flag"],
];

export const UNICODE_EMOJIS: UnicodeEmoji[] = RAW.map(([char, names]) => ({ char, names: names.split(" ") }));

const byName = new Map<string, string>();
for (const e of UNICODE_EMOJIS) for (const n of e.names) byName.set(n, e.char);

export const unicodeByName = (name: string) => byName.get(name);

export function searchUnicode(query: string, limit = 20): UnicodeEmoji[] {
  const q = query.toLowerCase();
  const starts = UNICODE_EMOJIS.filter((e) => e.names.some((n) => n.startsWith(q)));
  const contains = UNICODE_EMOJIS.filter((e) => !starts.includes(e) && e.names.some((n) => n.includes(q)));
  return [...starts, ...contains].slice(0, limit);
}

export const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🔥"];
