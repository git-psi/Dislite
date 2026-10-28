// Fils : en créer un depuis un message ou dans un salon.

import { backend, errorMessage } from "../ipc/tauri";
import { putChannel } from "../store/mutations";
import type { Snowflake } from "../store/types";
import { toast } from "../store/ui";
import { openChannel } from "./navigation";

const ONE_DAY = 1440;

export async function createThread(channelId: Snowflake, name: string, messageId?: Snowflake) {
  const title = name.trim().slice(0, 100);
  if (!title) return;
  try {
    const path = messageId ? `/channels/${channelId}/messages/${messageId}/threads` : `/channels/${channelId}/threads`;
    const body = messageId ? { name: title, auto_archive_duration: ONE_DAY } : { name: title, auto_archive_duration: ONE_DAY, type: 11 };
    const ch = await backend.api<any>("POST", path, body);
    putChannel(ch);
    openChannel(ch.id);
  } catch (e) {
    toast(`Couldn't create the thread: ${errorMessage(e)}`, true);
  }
}
