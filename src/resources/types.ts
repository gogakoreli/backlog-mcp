// Operation types for write_resource tool

export type OperationType = 'str_replace' | 'append' | 'prepend' | 'insert' | 'delete';

export interface StrReplaceOperation {
  type: 'str_replace';
  old_str: string;
  new_str: string;
}

export interface AppendOperation {
  type: 'append';
  content: string;
}

export interface PrependOperation {
  type: 'prepend';
  content: string;
}

export interface InsertOperation {
  type: 'insert';
  line: number;
  content: string;
}

export interface DeleteOperation {
  type: 'delete';
  content: string;
}

export type Operation = 
  | StrReplaceOperation 
  | AppendOperation 
  | PrependOperation 
  | InsertOperation 
  | DeleteOperation;

export interface WriteResourceResult {
  success: boolean;
  message: string;
  error?: string;
}
