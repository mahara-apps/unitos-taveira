export type AdminAccessState = "loading" | "allowed" | "denied" | "error";

export function resolveAdminAccessState(input: {
  isPending: boolean;
  isError: boolean;
  isSuperAdmin: boolean | undefined;
}): AdminAccessState {
  if (input.isError) return "error";
  if (input.isPending) return "loading";
  return input.isSuperAdmin ? "allowed" : "denied";
}