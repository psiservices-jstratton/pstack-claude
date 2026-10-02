export type Flag = {
  name: string;
  description: string;
};

export type Command = {
  name: string;
  summary: string;
  flags?: Flag[];
};

export type HelpOptions = {
  program?: string;
  width?: number;
};
