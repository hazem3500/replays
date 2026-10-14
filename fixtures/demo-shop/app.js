const cart = JSON.parse(sessionStorage.getItem('cart') || '[]');
const save = () => {
  sessionStorage.setItem('cart', JSON.stringify(cart));
  const count = document.getElementById('count');
  if (count) count.textContent = String(cart.length);
};
save();

const products = document.getElementById('products');
if (products) {
  fetch('/api/products')
    .then((response) => response.json())
    .then((items) => {
      for (const item of items) {
        const card = document.createElement('article');
        card.className = 'card';
        card.innerHTML = `<div class="swatch" style="background:${item.color}"></div><h2>${item.name}</h2><span class="price">$${item.price}</span>`;
        const add = document.createElement('button');
        add.textContent = 'Add to cart';
        add.dataset.id = item.id;
        add.addEventListener('click', () => {
          cart.push(item);
          save();
          add.textContent = 'Added';
        });
        card.append(add);
        products.append(card);
      }
    });
}

const list = document.getElementById('cart');
if (list) {
  for (const item of cart) {
    const li = document.createElement('li');
    li.innerHTML = `<span>${item.name}</span><span>$${item.price}</span>`;
    list.append(li);
  }
  if (!cart.length) list.innerHTML = '<li><span>Your cart is empty.</span></li>';
}

const apply = document.getElementById('apply');
if (apply) {
  apply.addEventListener('click', async () => {
    const code = document.getElementById('coupon').value.trim();
    const note = document.getElementById('coupon-note');
    const response = await fetch(`/api/coupons/${encodeURIComponent(code)}`);
    if (!response.ok) {
      note.textContent = 'That coupon is not valid.';
      console.warn('coupon lookup failed', response.status);
      console.error(new Error(`Coupon service answered ${response.status}`).message);
    }
  });
  document.getElementById('order').addEventListener('submit', (event) => {
    event.preventDefault();
    // A deliberately slow render so the Performance tab has something to show.
    const start = performance.now();
    while (performance.now() - start < 180) {}
    document.getElementById('order').hidden = true;
    document.getElementById('done').hidden = false;
    sessionStorage.removeItem('cart');
  });
}
