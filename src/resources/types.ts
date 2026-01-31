// Operation types for write_resource tool (mirrors fs_write)

export type OperationType = 'create' | 'str_replace' | 'insert' | 'append';

export interface CreateOperation {
  type: 'create';
  file_text: string;
}

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
  | CreateOperation
  | StrReplaceOperation 
  | InsertOperation 
  | AppendOperation;

export interface WriteResourceResult {
  success: boolean;
  message: string;
  error?: string;
}
