import { defineViewerPlugin } from '@hazem3500/replays/viewer';

export default defineViewerPlugin((api) => {
  api.registerIndexColumn({
    id: 'environment',
    label: 'Environment',
    render(container, { summary }) {
      container.textContent = String(summary.ext?.['company-host']?.environment ?? 'unknown');
    },
  });
  api.registerIndexFilter({
    id: 'customer-sessions',
    label: 'Customer sessions',
    type: 'switch',
    param: 'x-customer-session',
  });
  api.registerIndexSection({
    id: 'for-you',
    title: 'For you',
    render(container, { summaries, me, basePath }) {
      container.classList.add('company-for-you');
      const email = me?.email?.toLowerCase();
      const mine = email ? summaries.filter((summary) => summary.people?.some((person) => person.email?.toLowerCase() === email)) : [];
      if (!mine.length) {
        container.textContent = email ? 'No handoffs for you in this view.' : 'Sign in to see your handoffs.';
        return;
      }
      const list = document.createElement('ul');
      for (const summary of mine.slice(0, 5)) {
        const row = document.createElement('li');
        const link = document.createElement('a');
        link.href = `${basePath}/r/${encodeURIComponent(summary.id)}`;
        link.textContent = summary.title;
        row.append(link);
        list.append(row);
      }
      container.replaceChildren(list);
    },
  });
  api.registerInspectorTab({
    id: 'handoff',
    label: 'Handoff',
    render(container, { replay, theme }) {
      container.dataset.theme = theme;
      const list = document.createElement('dl');
      for (const person of replay.meta.people ?? []) {
        const role = document.createElement('dt');
        role.textContent = person.role;
        const name = document.createElement('dd');
        name.textContent = person.name ?? person.email ?? Object.values(person.handles ?? {}).join(', ');
        list.append(role, name);
      }
      if (!list.children.length) container.textContent = 'No handoff participants were supplied.';
      else container.replaceChildren(list);
    },
  });
  api.registerContextSection({
    id: 'privacy',
    title: 'Customer session handling',
    render(container, { replay }) {
      container.textContent =
        replay.context?.fields?.customerSession === true
          ? 'Customer session: editing is read-only. Share the replay link with its named reviewers.'
          : 'Staff recording: retain only what reviewers need. Typed values stay masked by the core sanitizer.';
    },
  });
});
