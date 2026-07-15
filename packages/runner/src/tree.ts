export interface MessageNode {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  parentId: string | null;
  children: string[];
  activeChildIndex: number;
  messageState: unknown;
  timestamp: number;
}

interface SerializedMessageTree {
  nodes: MessageNode[];
  rootId: string;
  activeLeafId: string;
}

export class MessageTree {
  private nodes: Map<string, MessageNode>;
  private rootId: string;
  private activeLeafId: string;

  constructor() {
    this.nodes = new Map();
    const root: MessageNode = {
      id: this.generateId(),
      role: "system",
      content: "",
      parentId: null,
      children: [],
      activeChildIndex: -1,
      messageState: undefined,
      timestamp: Date.now(),
    };
    this.nodes.set(root.id, root);
    this.rootId = root.id;
    this.activeLeafId = root.id;
  }

  private generateId(): string {
    return crypto.randomUUID();
  }

  addMessage(role: MessageNode["role"], content: string, parentId?: string): MessageNode {
    const parent = this.nodes.get(parentId ?? this.activeLeafId);
    if (!parent) {
      throw new Error(`Parent node not found: ${parentId ?? this.activeLeafId}`);
    }
    const node: MessageNode = {
      id: this.generateId(),
      role,
      content,
      parentId: parent.id,
      children: [],
      activeChildIndex: -1,
      messageState: undefined,
      timestamp: Date.now(),
    };
    this.nodes.set(node.id, node);
    parent.children.push(node.id);
    parent.activeChildIndex = parent.children.length - 1;
    this.navigateTo(node.id);
    return node;
  }

  getActivePath(): MessageNode[] {
    const path: MessageNode[] = [];
    let current: MessageNode | undefined = this.nodes.get(this.rootId);
    while (current) {
      path.push(current);
      if (current.activeChildIndex < 0 || current.activeChildIndex >= current.children.length) {
        break;
      }
      const nextId = current.children[current.activeChildIndex];
      current = nextId ? this.nodes.get(nextId) : undefined;
    }
    return path;
  }

  swipe(nodeId: string, delta: number): MessageNode | null {
    const node = this.nodes.get(nodeId);
    if (!node || !node.parentId) return null;
    const parent = this.nodes.get(node.parentId);
    if (!parent) return null;
    const currentIndex = parent.children.indexOf(nodeId);
    if (currentIndex < 0) return null;
    const newIndex = currentIndex + delta;
    if (newIndex < 0 || newIndex >= parent.children.length) return null;
    parent.activeChildIndex = newIndex;
    const newSiblingId = parent.children[newIndex];
    if (!newSiblingId) return null;
    this.navigateTo(newSiblingId);
    let leaf = this.nodes.get(newSiblingId);
    while (leaf && leaf.activeChildIndex >= 0 && leaf.activeChildIndex < leaf.children.length) {
      const nextId = leaf.children[leaf.activeChildIndex];
      leaf = nextId ? this.nodes.get(nextId) : undefined;
    }
    return leaf ?? null;
  }

  getSiblingInfo(nodeId: string): { current: number; total: number } {
    const node = this.nodes.get(nodeId);
    if (!node || !node.parentId) {
      return { current: 0, total: 1 };
    }
    const parent = this.nodes.get(node.parentId);
    if (!parent) {
      return { current: 0, total: 1 };
    }
    const currentIndex = parent.children.indexOf(nodeId);
    return { current: currentIndex, total: parent.children.length };
  }

  regenerate(nodeId: string, content: string): MessageNode {
    const node = this.nodes.get(nodeId);
    if (!node || !node.parentId) {
      throw new Error(`Cannot regenerate node without a parent: ${nodeId}`);
    }
    const parent = this.nodes.get(node.parentId);
    if (!parent) {
      throw new Error(`Parent node not found: ${node.parentId}`);
    }
    const sibling: MessageNode = {
      id: this.generateId(),
      role: node.role,
      content,
      parentId: parent.id,
      children: [],
      activeChildIndex: -1,
      messageState: undefined,
      timestamp: Date.now(),
    };
    this.nodes.set(sibling.id, sibling);
    parent.children.push(sibling.id);
    parent.activeChildIndex = parent.children.length - 1;
    this.navigateTo(sibling.id);
    return sibling;
  }

  setMessageState(nodeId: string, state: unknown): void {
    const node = this.nodes.get(nodeId);
    if (!node) {
      throw new Error(`Node not found: ${nodeId}`);
    }
    node.messageState = state;
  }

  getNode(nodeId: string): MessageNode | undefined {
    return this.nodes.get(nodeId);
  }

  getActiveLeaf(): MessageNode {
    const leaf = this.nodes.get(this.activeLeafId);
    if (!leaf) {
      throw new Error(`Active leaf not found: ${this.activeLeafId}`);
    }
    return leaf;
  }

  navigateTo(nodeId: string): void {
    const target = this.nodes.get(nodeId);
    if (!target) {
      throw new Error(`Node not found: ${nodeId}`);
    }
    let current = target;
    while (current.parentId) {
      const parent = this.nodes.get(current.parentId);
      if (!parent) break;
      const index = parent.children.indexOf(current.id);
      if (index >= 0) {
        parent.activeChildIndex = index;
      }
      current = parent;
    }
    this.activeLeafId = nodeId;
  }

  getRecentMessages(count: number): Array<{ role: string; content: string }> {
    const path = this.getActivePath().filter((node) => node.id !== this.rootId);
    return path.slice(-count).map((node) => ({ role: node.role, content: node.content }));
  }

  serialize(): string {
    const data: SerializedMessageTree = {
      nodes: Array.from(this.nodes.values()),
      rootId: this.rootId,
      activeLeafId: this.activeLeafId,
    };
    return JSON.stringify(data);
  }

  static deserialize(json: string): MessageTree {
    const data = JSON.parse(json) as SerializedMessageTree;
    const tree = Object.create(MessageTree.prototype) as MessageTree;
    tree.nodes = new Map(data.nodes.map((node) => [node.id, node]));
    tree.rootId = data.rootId;
    tree.activeLeafId = data.activeLeafId;
    return tree;
  }
}
