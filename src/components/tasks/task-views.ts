import { z } from "zod";
import {
  CalendarDays,
  GanttChartSquare,
  Kanban,
  ListTodo,
  User as UserIcon,
  Users,
} from "lucide-react";

export const VIEWS = ["mine", "list", "kanban", "board-assignee", "timeline", "calendar"] as const;
export type View = (typeof VIEWS)[number];

export const searchSchema = z.object({
  view: z.enum(VIEWS).catch("list"),
  taskId: z.string().uuid().optional(),
  // Alias de links antigos de notificação (`/tasks?task=<id>`).
  task: z.string().uuid().optional(),
  groupBy: z
    .enum(["none", "status", "priority", "project", "client", "assignee", "due"])
    .catch("status"),
  sort: z
    .enum([
      "title",
      "assignee",
      "project",
      "client",
      "priority",
      "status",
      "due",
      "created",
      "time",
    ])
    .catch("created"),
  dir: z.enum(["asc", "desc"]).catch("desc"),
  q: z.string().optional(),
});

export type TasksSearch = z.infer<typeof searchSchema>;

export const VIEW_META: Record<View, { label: string; icon: typeof ListTodo }> = {
  mine: { label: "Minhas tarefas", icon: UserIcon },
  list: { label: "Lista", icon: ListTodo },
  kanban: { label: "Kanban por status", icon: Kanban },
  "board-assignee": { label: "Kanban por responsável", icon: Users },
  timeline: { label: "Timeline do mês", icon: GanttChartSquare },
  calendar: { label: "Calendário", icon: CalendarDays },
};
