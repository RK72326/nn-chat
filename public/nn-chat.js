'use strict';

function revealPage() {
  document.body.classList.add('is-ready');
}

window.addEventListener('load', () => {
  window.scrollTo({
    top: document.body.scrollHeight,
    behavior: 'instant'
  });

  requestAnimationFrame(() => {
    revealPage();
  });
});

setTimeout(revealPage, 1000);

const formElement = document.forms['message-form'];
const textareaElement = formElement ? formElement.elements['content'] : null;
if (formElement && textareaElement) {
  textareaElement.addEventListener('keydown', (event) => {
    if (isPressedSubmitKey(event)) {
      event.preventDefault();
      formElement.submit();
    }
  });
}

function isPressedSubmitKey(event) {
  if (event.key !== 'Enter') {
    return false;
  }
  return event.ctrlKey || event.metaKey;
}

const tooltipTriggerElements = document.querySelectorAll('[data-bs-toggle="tooltip"]');
tooltipTriggerElements.forEach((tooltipTriggerElement) => {
  new bootstrap.Tooltip(tooltipTriggerElement);
});

const scrollTopBtn = document.getElementById('scroll-top-btn');
const scrollBottomBtn = document.getElementById('scroll-bottom-btn');

if (scrollTopBtn) {
  scrollTopBtn.addEventListener('click', () => {
    window.scrollTo({
      top: 0,
      behavior: 'instant'
    });
  });
}

if (scrollBottomBtn) {
  scrollBottomBtn.addEventListener('click', () => {
    window.scrollTo({
      top: document.body.scrollHeight,
      behavior: 'instant'
    });
  });
}