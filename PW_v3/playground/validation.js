// playground/validation.js
// Pure validation rules shared by the browser (submit.js) and the
// submit-character Netlify Function. No DOM, no network.
(function (exports) {
  var TITLE_MAX_LENGTH = 60;
  var MESSAGE_MAX_LENGTH = 280;
  var IMAGE_MAX_BYTES = 150000;
  var IMAGE_DATA_URL_PREFIX = 'data:image/png;base64,';

  function validateTitle(title) {
    if (typeof title !== 'string' || title.trim().length === 0) {
      return { valid: false, error: 'Title is required.' };
    }
    if (title.length > TITLE_MAX_LENGTH) {
      return { valid: false, error: 'Title must be ' + TITLE_MAX_LENGTH + ' characters or fewer.' };
    }
    return { valid: true };
  }

  function validateMessage(message) {
    if (message === undefined || message === null || message === '') {
      return { valid: true };
    }
    if (typeof message !== 'string') {
      return { valid: false, error: 'Message must be text.' };
    }
    if (message.length > MESSAGE_MAX_LENGTH) {
      return { valid: false, error: 'Message must be ' + MESSAGE_MAX_LENGTH + ' characters or fewer.' };
    }
    return { valid: true };
  }

  function base64ByteLength(base64) {
    var len = base64.length;
    var padding = 0;
    if (base64.slice(-2) === '==') padding = 2;
    else if (base64.slice(-1) === '=') padding = 1;
    return (len / 4) * 3 - padding;
  }

  function validateImageDataUrl(dataUrl) {
    if (typeof dataUrl !== 'string' || dataUrl.indexOf(IMAGE_DATA_URL_PREFIX) !== 0) {
      return { valid: false, error: 'Image must be a PNG data URL.' };
    }
    var base64 = dataUrl.slice(IMAGE_DATA_URL_PREFIX.length);
    if (base64.length === 0) {
      return { valid: false, error: 'Image data is empty.' };
    }
    if (base64ByteLength(base64) > IMAGE_MAX_BYTES) {
      return { valid: false, error: 'Image is too large.' };
    }
    return { valid: true };
  }

  exports.TITLE_MAX_LENGTH = TITLE_MAX_LENGTH;
  exports.MESSAGE_MAX_LENGTH = MESSAGE_MAX_LENGTH;
  exports.IMAGE_MAX_BYTES = IMAGE_MAX_BYTES;
  exports.validateTitle = validateTitle;
  exports.validateMessage = validateMessage;
  exports.validateImageDataUrl = validateImageDataUrl;
})(typeof module !== 'undefined' && module.exports ? module.exports : (window.PlaygroundValidation = {}));
