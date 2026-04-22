// Sample TypeScript source file for E2E testing

interface User {
  id: number;
  name: string;
  email: string;
}

async function fetchUser(id: number): Promise<User> {
  const response = await fetch(`/api/users/${id}`);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response.json();
}

class UserService {
  private cache = new Map<number, User>();

  async getUser(id: number): Promise<User> {
    if (this.cache.has(id)) {
      return this.cache.get(id)!;
    }
    const user = await fetchUser(id);
    this.cache.set(id, user);
    return user;
  }

  clearCache(): void {
    this.cache.clear();
  }
}

export { UserService, fetchUser };
export type { User };
