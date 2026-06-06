<!-- title: Getting Started with TypeScript -->
<!-- date: 2026-05-20 -->
<!-- tags: typescript, guide -->

TypeScript is a strongly typed superset of JavaScript that compiles to plain JavaScript. Here's what you need to know to get started.

## Why TypeScript?

TypeScript adds static type checking to JavaScript, catching errors at compile time rather than runtime. This means fewer bugs in production.

### Key Benefits

- **Better IDE support** — autocomplete, navigation, and refactoring
- **Self-documenting code** — types serve as inline documentation
- **Safer refactoring** — the compiler catches breaking changes

## Basic Types

```typescript
const name: string = "Alice"
const age: number = 30
const isActive: boolean = true
const items: string[] = ["a", "b", "c"]
```

## Interfaces

```typescript
interface User {
  id: string
  name: string
  email: string
}

function greet(user: User): string {
  return `Hello, ${user.name}!`
}
```

Start small and add types gradually.
