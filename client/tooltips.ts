export interface TooltipContent {
  title?: string;
  lines?: readonly string[];
}

export type TooltipProvider = () => string | TooltipContent | null | undefined;

type TooltipValue = string | TooltipContent;

const managers = new WeakMap<Document, TooltipManager>();
let nextTooltipId = 1;

/** One accessible tooltip layer shared by explicit and data-tooltip bindings. */
export class TooltipManager {
  private readonly tooltip: HTMLDivElement;
  private readonly content: HTMLDivElement;
  private readonly abort = new AbortController();
  private activeAnchor: HTMLElement | null = null;
  private hideTimer = 0;
  private contentSignature = '';
  private readonly bindings = new WeakMap<HTMLElement, TooltipProvider>();

  constructor(private readonly doc: Document = document) {
    this.tooltip = doc.createElement('div');
    this.tooltip.className = 'game-tooltip';
    this.tooltip.id = `game-tooltip-${nextTooltipId++}`;
    this.tooltip.setAttribute('role', 'tooltip');
    this.tooltip.hidden = true;
    this.content = doc.createElement('div');
    this.tooltip.append(this.content);
    (doc.body ?? doc.documentElement).append(this.tooltip);

    const opts = {signal: this.abort.signal};
    doc.addEventListener('pointerover', event => this.onPointerOver(event), opts);
    doc.addEventListener('pointerout', event => this.onPointerOut(event), opts);
    doc.addEventListener('focusin', event => this.onFocusIn(event), opts);
    doc.addEventListener('focusout', event => this.onFocusOut(event), opts);
    doc.addEventListener('keydown', event => {
      if (event.key === 'Escape' && this.activeAnchor) {
        this.hide();
      }
    }, opts);
    const repositionAfterMotion=(event:Event)=>{
      const anchor=this.activeAnchor,target=event.target;
      if(!anchor||!(target instanceof Node))return;
      if(target===anchor||target.contains(anchor)||anchor.contains(target))this.reposition();
    };
    doc.addEventListener('transitionend',repositionAfterMotion,{capture:true,signal:this.abort.signal});
    doc.addEventListener('animationend',repositionAfterMotion,{capture:true,signal:this.abort.signal});
    doc.defaultView?.addEventListener('resize', () => this.reposition(), opts);
    doc.defaultView?.addEventListener('scroll', () => this.reposition(), {capture: true, signal: this.abort.signal});
  }

  bind(element: HTMLElement, provider: TooltipProvider | TooltipValue): () => void {
    const getter: TooltipProvider = typeof provider === 'function' ? provider : () => provider;
    this.bindings.set(element, getter);
    return () => {
      if (this.activeAnchor === element) this.hide();
      this.bindings.delete(element);
    };
  }

  show(anchor: HTMLElement, value?: TooltipValue): void {
    if (!anchor.isConnected || anchor.ownerDocument !== this.doc) {
      if (this.activeAnchor === anchor || this.activeAnchor && !this.activeAnchor.isConnected) this.hide();
      return;
    }
    const provider = value === undefined ? this.providerFor(anchor) : () => value;
    const provided = provider?.();
    const normalized = this.normalize(provided);
    if (!normalized) { if (this.activeAnchor === anchor) this.hide(); return; }
    this.doc.defaultView?.clearTimeout(this.hideTimer);
    const wasVisible = !this.tooltip.hidden, anchorChanged = this.activeAnchor !== anchor;
    if (this.activeAnchor && anchorChanged) this.detachDescription(this.activeAnchor);
    this.activeAnchor = anchor;
    const prior = (anchor.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
    if (!prior.includes(this.tooltip.id)) anchor.setAttribute('aria-describedby', [...prior, this.tooltip.id].join(' '));
    const contentChanged = this.render(normalized);
    this.tooltip.hidden = false;
    if (!wasVisible || anchorChanged || contentChanged) this.reposition();
  }

  /** Refreshes live health/item content without changing the focused or hovered anchor. */
  refresh(reposition = false): void {
    const anchor=this.activeAnchor;
    if(!anchor)return;
    if(!anchor.isConnected||anchor.ownerDocument!==this.doc){this.hide();return;}
    this.show(anchor);
    if(reposition&&this.activeAnchor===anchor&&!this.tooltip.hidden)this.reposition();
  }

  hide(): void {
    this.doc.defaultView?.clearTimeout(this.hideTimer);
    const anchor = this.activeAnchor;
    if (anchor) this.detachDescription(anchor);
    this.activeAnchor = null;
    this.tooltip.hidden = true;
  }

  private detachDescription(anchor: HTMLElement): void {
    const ids = (anchor.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(id => id && id !== this.tooltip.id);
    if (ids.length) anchor.setAttribute('aria-describedby', ids.join(' '));
    else anchor.removeAttribute('aria-describedby');
  }

  dispose(): void {
    this.hide();
    this.abort.abort();
    this.tooltip.remove();
    managers.delete(this.doc);
  }

  private providerFor(anchor: HTMLElement): TooltipProvider | undefined {
    const explicit = this.bindings.get(anchor);
    if (explicit) return explicit;
    const tagged = anchor.closest<HTMLElement>('[data-tooltip]');
    if (!tagged) return undefined;
    return () => {
      const lines = (tagged.dataset.tooltipDetail ?? '').split('\n').map(line => line.trim()).filter(Boolean);
      return {title: tagged.dataset.tooltipTitle, lines: lines.length ? lines : [tagged.dataset.tooltip ?? '']};
    };
  }

  private normalize(value: TooltipValue | null | undefined): TooltipContent | null {
    if (typeof value === 'string') return value.trim() ? {lines: value.split('\n').map(line => line.trim()).filter(Boolean)} : null;
    if (!value) return null;
    const title = value.title?.trim();
    const lines = value.lines?.map(line => line.trim()).filter(Boolean) ?? [];
    return title || lines.length ? {title, lines} : null;
  }

  private render(value: TooltipContent): boolean {
    const signature = JSON.stringify(value);
    if (signature === this.contentSignature) return false;
    this.contentSignature = signature;
    this.content.replaceChildren();
    if (value.title) {
      const title = this.doc.createElement('strong');
      title.className = 'game-tooltip-title';
      title.textContent = value.title;
      this.content.append(title);
    }
    for (const line of value.lines ?? []) {
      const row = this.doc.createElement('span');
      row.className = 'game-tooltip-line';
      row.textContent = line;
      this.content.append(row);
    }
    return true;
  }

  private reposition(): void {
    const anchor = this.activeAnchor;
    if (!anchor || this.tooltip.hidden) return;
    if (!anchor.isConnected) { this.hide(); return; }
    const rect = anchor.getBoundingClientRect();
    const tip = this.tooltip.getBoundingClientRect();
    const view = this.doc.defaultView;
    const width = view?.innerWidth ?? this.doc.documentElement.clientWidth;
    const height = view?.innerHeight ?? this.doc.documentElement.clientHeight;
    const gap = 9, margin = 8;
    let left = rect.left + (rect.width - tip.width) / 2;
    let top = rect.top - tip.height - gap;
    if (top < margin) top = rect.bottom + gap;
    left = Math.max(margin, Math.min(width - tip.width - margin, left));
    top = Math.max(margin, Math.min(height - tip.height - margin, top));
    this.tooltip.style.left = `${left}px`;
    this.tooltip.style.top = `${top}px`;
  }

  private onPointerOver(event: Event): void {
    const anchor = this.eventAnchor(event);
    if (!anchor) return;
    const related = (event as PointerEvent).relatedTarget;
    if (related instanceof Node && anchor.contains(related)) return;
    this.show(anchor);
  }

  private onPointerOut(event: Event): void {
    const anchor = this.activeAnchor;
    if (!anchor || !anchor.contains(event.target as Node)) return;
    const related = (event as PointerEvent).relatedTarget;
    if (related instanceof Node && anchor.contains(related)) return;
    this.doc.defaultView?.clearTimeout(this.hideTimer);
    this.hideTimer = this.doc.defaultView?.setTimeout(() => {
      if (this.activeAnchor === anchor && !anchor.matches(':focus')) this.hide();
    }, 60) ?? 0;
  }

  private onFocusIn(event: Event): void {
    const anchor = this.eventAnchor(event);
    if (anchor) this.show(anchor);
  }

  private onFocusOut(event: Event): void {
    const anchor = this.activeAnchor;
    if (!anchor || !anchor.contains(event.target as Node)) return;
    const related = (event as FocusEvent).relatedTarget;
    if (related instanceof Node && anchor.contains(related)) return;
    this.hide();
  }

  private eventAnchor(event: Event): HTMLElement | null {
    const target = event.target;
    if (!(target instanceof Element)) return null;
    const anchor = target.closest<HTMLElement>('[data-tooltip]') ?? target.closest<HTMLElement>('*');
    if (!anchor) return null;
    let current: HTMLElement | null = anchor;
    while (current) {
      if (this.bindings.has(current) || current.hasAttribute('data-tooltip')) return current;
      current = current.parentElement;
    }
    return null;
  }
}

export function getTooltipManager(doc: Document = document): TooltipManager {
  let manager = managers.get(doc);
  if (!manager) {
    manager = new TooltipManager(doc);
    managers.set(doc, manager);
  }
  return manager;
}
