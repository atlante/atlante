export interface User {
  name: string;
  role: string;
}

export function canDelete(user: User): boolean {
  return user.role !== "viewer";
}
