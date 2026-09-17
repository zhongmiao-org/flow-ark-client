const form = document.querySelector('#lab-form');
const q = (selector) => document.querySelector(selector);
let events = [],
  rowId = 0,
  cityRequest = 0,
  busy = false;
const projects = [
  { value: 'flowark', label: 'FlowArk · 流程工作台' },
  { value: 'workbench', label: 'Workbench · 测试工作区' },
  { value: 'archive', label: 'Archive · 文档归档' },
];
function values() {
  const data = new FormData(form);
  const result = Object.fromEntries(
    [...data.entries()].filter(([key, value]) => key !== 'password' && !(value instanceof File)),
  );
  result.passwordLength = String(data.get('password') ?? '').length;
  result.features = data.getAll('features');
  result.skills = data.getAll('skills');
  result.contacts = [...q('#contacts').children].map((row) => ({
    name: row.querySelector('[data-contact-name]').value,
    email: row.querySelector('[data-contact-email]').value,
  }));
  delete result.contactName;
  delete result.contactEmail;
  result.richNote = q('#rich-note').innerText;
  result.sync = q('#sync-switch').getAttribute('aria-checked') === 'true';
  result.invoice = q('#invoice-toggle').checked;
  result.agreement = q('#agreement').checked;
  const file = q('#attachment').files[0];
  result.attachment = file ? { name: file.name, size: file.size, type: file.type } : null;
  return result;
}
function update() {
  const changes = {};
  for (const event of events)
    if (event.type === 'change') changes[event.id] = (changes[event.id] ?? 0) + 1;
  q('#change-counts').textContent = JSON.stringify(changes, null, 2);
  q('#priority-output').textContent = q('#priority').value;
  q('#current-values').textContent = JSON.stringify(values(), null, 2);
  q('#event-count').textContent = events.length;
  q('#log-count').textContent = events.length;
}
function log(type, element) {
  events.push({ type, id: element.id || element.name || element.tagName });
  const item = document.createElement('li');
  item.textContent = `${events.length}. ${type} · ${element.id || element.name}`;
  q('#event-log').prepend(item);
  while (q('#event-log').children.length > 20) q('#event-log').lastChild.remove();
  update();
}
function addContact() {
  if (q('#contacts').children.length >= 3) return;
  const id = ++rowId,
    row = document.createElement('div');
  row.className = 'contact-row';
  row.dataset.row = String(id);
  row.innerHTML = `<input id="contact-name-${id}" name="contactName" data-contact-name aria-label="联系人 ${id} 姓名" placeholder="虚构姓名"><input id="contact-email-${id}" name="contactEmail" data-contact-email aria-label="联系人 ${id} 邮箱" type="email" placeholder="test@example.com"><button id="contact-remove-${id}" type="button" aria-label="删除联系人 ${id}">移除</button>`;
  row.querySelector('button').onclick = () => {
    row.remove();
    updateContacts();
    log('remove', row);
  };
  q('#contacts').append(row);
  updateContacts();
}
function updateContacts() {
  q('#contacts-count').textContent = q('#contacts').children.length + ' 行';
  q('#add-contact').disabled = q('#contacts').children.length >= 3;
  update();
}
q('#add-contact').onclick = () => {
  addContact();
  log('add', q('#add-contact'));
};
q('#province').addEventListener('change', async () => {
  const request = ++cityRequest,
    province = q('#province').value;
  q('#city').disabled = true;
  q('#city').replaceChildren(new Option('加载中…', ''));
  q('#city-status').textContent = '正在加载城市';
  try {
    const response = await fetch('/api/cities?province=' + encodeURIComponent(province));
    if (!response.ok) throw new Error('城市加载失败');
    const items = await response.json();
    if (request !== cityRequest) return;
    q('#city').replaceChildren(
      new Option('请选择城市', ''),
      ...items.map((item) => new Option(item.label, item.value)),
    );
    q('#city').disabled = !province;
    q('#city-status').textContent = province ? '城市已就绪' : '等待选择';
    update();
  } catch (error) {
    if (request === cityRequest) {
      q('#city-status').textContent = error.message;
      q('#city').replaceChildren(new Option('加载失败', ''));
    }
  }
});
q('#invoice-toggle').addEventListener('change', () => {
  const enabled = q('#invoice-toggle').checked;
  q('#invoice-fields').hidden = !enabled;
  q('#invoice-title').disabled = !enabled;
  q('#invoice-title').required = enabled;
  if (!enabled) q('#invoice-title').value = '';
  update();
});
q('#sync-switch').onclick = () => {
  q('#sync-switch').setAttribute(
    'aria-checked',
    String(q('#sync-switch').getAttribute('aria-checked') !== 'true'),
  );
  log('switch', q('#sync-switch'));
};
function renderProjects() {
  const text = q('#project-search').value.toLowerCase();
  q('#project-options').replaceChildren();
  for (const project of projects.filter((p) => p.label.toLowerCase().includes(text))) {
    const option = document.createElement('button');
    option.type = 'button';
    option.role = 'option';
    option.id = 'project-' + project.value;
    option.textContent = project.label;
    option.onclick = () => {
      q('#project-id').value = project.value;
      q('#project-search').value = project.label;
      q('#project-options').hidden = true;
      q('#project-search').setAttribute('aria-expanded', 'false');
      log('select', q('#project-search'));
    };
    q('#project-options').append(option);
  }
  q('#project-options').hidden = false;
  q('#project-search').setAttribute('aria-expanded', 'true');
}
q('#project-search').addEventListener('input', () => {
  q('#project-id').value = '';
  renderProjects();
});
q('#project-search').addEventListener('focus', renderProjects);
q('#project-search').addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    q('#project-options').hidden = true;
    q('#project-search').setAttribute('aria-expanded', 'false');
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    q('#project-options button')?.focus();
  }
});
document.addEventListener('click', (event) => {
  if (!event.target.closest('.project')) {
    q('#project-options').hidden = true;
    q('#project-search').setAttribute('aria-expanded', 'false');
  }
});
form.addEventListener('input', (event) => {
  if (event.target.id === 'start-date' || event.target.id === 'end-date') {
    q('#end-date').setCustomValidity(
      q('#end-date').value &&
        q('#start-date').value &&
        q('#end-date').value < q('#start-date').value
        ? '结束日期不能早于开始日期'
        : '',
    );
  }
  log('input', event.target);
  q('#form-state').textContent = '填写中';
});
form.addEventListener('change', (event) => log('change', event.target));
form.addEventListener(
  'invalid',
  () => {
    q('#submit-status').dataset.state = 'invalid';
    q('#submit-status').textContent = '请修正必填项或字段格式，尚未发送到服务端。';
    q('#form-state').textContent = '需要修正';
  },
  true,
);
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy) return;
  busy = true;
  q('#submit').disabled = true;
  q('#submit-status').dataset.state = 'pending';
  q('#submit-status').textContent = '正在核对…';
  try {
    const file = q('#attachment').files[0];
    if (file && (!file.name.endsWith('.txt') || file.size > 65536))
      throw new Error('仅允许不超过 64 KB 的 .txt 文件');
    const payload = values();
    if (file) payload.attachment = { ...payload.attachment, content: await file.text() };
    const response = await fetch('/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: payload, reject: q('#reject-server').checked }),
    });
    const result = await response.json();
    q('#server-result').textContent = JSON.stringify(result, null, 2);
    if (!response.ok) throw new Error(result.error || '提交失败');
    q('#submit-status').dataset.state = 'success';
    q('#submit-status').textContent = '提交成功 · ' + result.receiptId;
    q('#form-state').textContent = '已收到回执';
  } catch (error) {
    q('#submit-status').dataset.state = 'error';
    q('#submit-status').textContent = error.message;
    q('#form-state').textContent = '提交未通过';
  } finally {
    busy = false;
    q('#submit').disabled = false;
  }
});
form.addEventListener('reset', () => {
  cityRequest++;
  setTimeout(() => {
    q('#city').replaceChildren(new Option('先选择省份', ''));
    q('#city').disabled = true;
    q('#city-status').textContent = '等待选择';
    q('#invoice-fields').hidden = true;
    q('#invoice-title').disabled = true;
    q('#invoice-title').required = false;
    q('#end-date').setCustomValidity('');
    q('#rich-note').textContent = '';
    q('#sync-switch').setAttribute('aria-checked', 'false');
    q('#project-options').hidden = true;
    q('#project-search').setAttribute('aria-expanded', 'false');
    q('#contacts').replaceChildren();
    rowId = 0;
    events = [];
    q('#event-log').replaceChildren();
    addContact();
    q('#server-result').textContent = '尚无回执';
    q('#submit-status').dataset.state = 'idle';
    q('#submit-status').textContent = '尚未提交';
    q('#form-state').textContent = '等待填写';
    update();
  }, 0);
});
addContact();
update();
