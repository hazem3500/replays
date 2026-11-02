import type { FormEventHandler, ReactNode } from 'react';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  CircleIcon,
  CodeIcon,
  LeafIcon,
  LockKeyholeIcon,
  PackageIcon,
  RadioIcon,
  ShieldCheckIcon,
  ShoppingBagIcon,
  TruckIcon,
  WifiOffIcon,
} from 'lucide-react';
import { Button } from '../../src/client/components/ui/button.tsx';
import { Input } from '../../src/client/components/ui/input.tsx';
import './recorder-host.css';

// Story-only semantic wrappers: the app currently exports Button/Input but no Card/Label/Textarea primitives.
function Field({ label, id, hint, children }: { label: string; id: string; hint?: string; children: ReactNode }) {
  return (
    <div className="demo-field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && <span className="demo-hint">{hint}</span>}
    </div>
  );
}
export interface RecorderHostProps {
  status?: string;
  uploadMode?: string;
  recordAction?: () => void;
  onSubmit?: FormEventHandler<HTMLFormElement>;
  onError?: () => void;
  onRequest?: () => void;
  saved?: boolean;
  problem?: string;
  requestStatus?: string;
  footer?: ReactNode;
}
export function RecorderHost({
  status = 'idle',
  uploadMode = 'mock',
  recordAction,
  onSubmit,
  onError,
  onRequest,
  saved = false,
  problem = '',
  requestStatus = 'No request sent',
  footer,
}: RecorderHostProps) {
  const active = ['consent', 'starting', 'recording', 'review', 'uploading'].includes(status);
  return (
    <div className="recorder-demo">
      <div className="demo-lab-bar" data-recorder-block>
        <div className="demo-lab-label">
          <RadioIcon size={16} />
          <span>Recorder playground</span>
          <span className="demo-environment">{uploadMode === 'server' ? 'Server upload' : 'Local sandbox'}</span>
        </div>
        <div className="demo-lab-actions">
          <output className="demo-recorder-state" data-active={status === 'recording' || undefined} data-testid="recorder-status">
            <span />
            {status}
          </output>
          <Button className="demo-record" onClick={recordAction} disabled={!recordAction || active}>
            <CircleIcon size={12} aria-hidden="true" />
            Record
          </Button>
        </div>
      </div>
      <div className="demo-storefront">
        <header className="demo-shop-header">
          <div className="demo-shop-brand">
            <span className="demo-brand-mark">
              <LeafIcon size={21} />
            </span>
            <span>
              Pinecone<span className="demo-brand-subtitle">GOODS FOR EVERY DAY</span>
            </span>
          </div>
          <div className="demo-secure">
            <LockKeyholeIcon size={13} /> Secure checkout
          </div>
        </header>
        <nav className="demo-checkout-steps" aria-label="Checkout progress">
          <span>
            <CheckIcon size={12} />
            Bag
          </span>
          <i />
          <span aria-current="step">
            <span className="demo-step-number">2</span>Delivery
          </span>
          <i />
          <span>
            <span className="demo-step-number">3</span>Payment
          </span>
        </nav>
        <div className="demo-checkout-grid">
          <section className="demo-delivery-card">
            <div className="demo-card-heading">
              <span className="demo-eyebrow">ALMOST THERE</span>
              <h1>Where should we send it?</h1>
              <p>A few details, then it’s on its way.</p>
            </div>
            <form onSubmit={onSubmit ?? ((event) => event.preventDefault())} className="demo-delivery-form">
              <Field label="Customer name" id="host-customer">
                <Input className="demo-input" id="host-customer" name="customer" autoComplete="off" placeholder="Alex Morgan" />
              </Field>
              <Field label="Account password" id="host-password" hint="Demo account only. Passwords stay hidden in recordings.">
                <Input
                  className="demo-input"
                  id="host-password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Enter your password"
                />
              </Field>
              <Field label="Delivery instructions" id="host-instructions" hint="Optional · a safe place, a door code, or a friendly note.">
                <textarea
                  className="demo-textarea"
                  id="host-instructions"
                  name="instructions"
                  rows={3}
                  placeholder="Leave it by the front door…"
                />
              </Field>
              <div className="demo-form-footer">
                <span className="demo-safe-note">
                  <ShieldCheckIcon size={14} /> Your details stay private
                </span>
                <Button type="submit" className="demo-save">
                  Save delivery
                  <ArrowRightIcon size={14} aria-hidden="true" />
                </Button>
              </div>
              {saved && (
                <div className="demo-saved" role="status">
                  <CheckIcon size={14} /> Delivery preferences saved.
                </div>
              )}
            </form>
          </section>
          <aside className="demo-order-column" aria-label="Order summary">
            <section className="demo-order-card">
              <div className="demo-order-heading">
                <h2>Your bag</h2>
                <span>1 item</span>
              </div>
              <div className="demo-product">
                <div className="demo-product-art">
                  <ShoppingBagIcon size={38} strokeWidth={1.15} />
                </div>
                <div>
                  <strong>The everyday tote</strong>
                  <span>Natural canvas · One size</span>
                  <span className="demo-product-qty">Qty 1</span>
                </div>
                <strong>$28.00</strong>
              </div>
              <dl className="demo-totals">
                <div>
                  <dt>Subtotal</dt>
                  <dd>$28.00</dd>
                </div>
                <div>
                  <dt>Delivery</dt>
                  <dd className="demo-free">On us</dd>
                </div>
                <div className="demo-total">
                  <dt>Total</dt>
                  <dd>$28.00</dd>
                </div>
              </dl>
              <p className="demo-dispatch">
                <TruckIcon size={15} /> Ships in 1–2 business days
              </p>
            </section>
            <section className="demo-problems">
              <div className="demo-problem-title">
                <CodeIcon size={15} />
                <h2>Simulate problems</h2>
                <span>DEMO</span>
              </div>
              <p>Leave a breadcrumb for the recording.</p>
              <div className="demo-trigger-actions">
                <Button type="button" variant="outline" className="demo-trigger" onClick={onError}>
                  <CodeIcon size={14} />
                  Trigger console error
                </Button>
                <Button type="button" variant="outline" className="demo-trigger" onClick={onRequest}>
                  <WifiOffIcon size={14} />
                  Fetch failed checkout
                </Button>
              </div>
              <div className="demo-log" role="log" aria-label="Demo activity">
                <div>
                  <span className="demo-log-dot" />
                  <span data-testid="request-status">{requestStatus}</span>
                </div>
                {problem && (
                  <div className="demo-log-error" role="alert">
                    <span className="demo-log-dot" />
                    <span>{problem}</span>
                  </div>
                )}
              </div>
            </section>
          </aside>
        </div>
        <footer className="demo-shop-footer">
          <span>
            <ArrowLeftIcon size={12} />
            Back to shopping
          </span>
          <span>
            <PackageIcon size={13} />A fictional shop. A real recording.
          </span>
        </footer>
      </div>
      {footer}
    </div>
  );
}
