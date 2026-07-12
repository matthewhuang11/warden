const { formatCategoryList } = require('../src/banner');

describe('formatCategoryList', () => {
  test('formats a single category', () => {
    expect(formatCategoryList(['EMAIL'])).toBe('an email address');
  });

  test('formats two categories with "and"', () => {
    expect(formatCategoryList(['EMAIL', 'PHONE'])).toBe('an email address and a phone number');
  });

  test('formats three or more categories with an Oxford comma', () => {
    expect(formatCategoryList(['EMAIL', 'PHONE', 'SSN'])).toBe(
      'an email address, a phone number, and an SSN'
    );
  });

  test('de-duplicates repeated categories', () => {
    expect(formatCategoryList(['EMAIL', 'EMAIL', 'PHONE'])).toBe('an email address and a phone number');
  });

  test('falls back to a generic label for an unknown type', () => {
    expect(formatCategoryList(['EMPLOYEE_ID'])).toBe('a employee_id');
  });
});
