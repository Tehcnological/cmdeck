import { createFileRoute } from "@tanstack/react-router";

import { MemorySettings } from "../fork/memory/MemorySettings";

export const Route = createFileRoute("/_chat/settings/memory")({ component: MemorySettings });
