import { useState, type ReactNode } from 'react';
import { Button } from '../../src/client/components/ui/button.tsx';
import { Input } from '../../src/client/components/ui/input.tsx';

export const CHECKOUT_PATH = '/demo-shop/checkout';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="rec-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

/** A small host page for the recorder to capture: inputs to mask, a failing request and a console error. */
export function DemoShop({ onReport, reportDisabled }: { onReport: () => void; reportDisabled: boolean }) {
  const [order, setOrder] = useState('Not placed');
  const placeOrder = async () => {
    setOrder('Placing order');
    const response = await fetch(CHECKOUT_PATH, { method: 'POST', body: JSON.stringify({ items: 2 }) }).catch(() => null);
    const status = response?.status ?? 0;
    console.error(`Checkout failed with HTTP ${status}`);
    setOrder(`Order failed (${status})`);
  };
  return (
    <section className="rec-shop" aria-labelledby="rec-shop-title">
      <header className="rec-shop-header">
        <p className="rec-eyebrow">Pinecone Goods</p>
        <h2 id="rec-shop-title">Checkout</h2>
      </header>
      <form className="rec-shop-form" onSubmit={(event) => event.preventDefault()}>
        <Field label="Full name">
          <Input name="name" autoComplete="off" placeholder="Ada Lovelace" />
        </Field>
        <Field label="Delivery note">
          <Input name="note" autoComplete="off" placeholder="Leave by the blue door" />
        </Field>
        <Field label="Account password">
          <Input name="password" type="password" autoComplete="off" />
        </Field>
        <div className="rec-shop-actions">
          <Button type="button" variant="outline" size="lg" onClick={() => void placeOrder()}>
            Place order
          </Button>
          <p role="status" className="rec-muted">
            {order}
          </p>
        </div>
      </form>
      <footer className="rec-shop-footer">
        <p className="rec-muted">Something broken? Send support a recording of this tab.</p>
        <Button type="button" size="lg" disabled={reportDisabled} onClick={onReport}>
          Report a problem
        </Button>
      </footer>
    </section>
  );
}
