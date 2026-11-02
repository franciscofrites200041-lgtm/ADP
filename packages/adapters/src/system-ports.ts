import type { Clock, IdGen } from "@middleware/core";
import { createId } from "@middleware/db";

export const createSystemClock = (): Clock => ({ now: () => new Date() });

export const createUuidV7IdGen = (): IdGen => ({ newId: createId });
