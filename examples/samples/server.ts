import { serve } from 'bun';

type Todo = { id: number; title: string; done: boolean };
const todos = new Map<number, Todo>();
let nextId = 1;

serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === 'POST' && url.pathname === '/todos') {
      const { title } = (await req.json()) as { title: string };
      const todo = { id: nextId++, title, done: false };
      todos.set(todo.id, todo);
      return Response.json(todo, { status: 201 });
    }
    return Response.json([...todos.values()]);
  },
});
