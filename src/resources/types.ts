// Operation types for write_resource tool

export type OperationType = 'str_replace' | 'insert' | 'append';

export interface StrReplaceOperation {
  type: 'str_replace';
  old_str: string;
  new_str: string;
}

export interface InsertOperation {
  type: 'insert';
  insert_line: number;
  new_str: string;
}

export interface AppendOperation {
  type: 'append';
  new_str: string;
}

export type Operation = 
  | StrReplaceOperation 
  | InsertOperation 
  | AppendOperation;

export interface WriteResourceResult {
  success: boolean;
  message: string;
  error?: string;
}
