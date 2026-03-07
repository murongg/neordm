declare module "redis-commands" {
  export const list: string[];
  export function exists(command: string): boolean;
  export function hasFlag(command: string, flag: string): boolean;
  export function getKeyIndexes(
    command: string,
    args: string[]
  ): number[];
}
