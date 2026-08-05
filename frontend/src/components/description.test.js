import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDescription } from './description.js';

test('recognizes headings, prose, bullets, and numbered instructions', () => {
    const blocks = parseDescription(`Role Summary\nBuild secure systems.\n\nDuties and Responsibilities:\n• Develop APIs.\n· Review code.\n\nSubmission Guidelines\n1. Send your CV.\n2) Include the vacancy number.`);

    assert.deepEqual(blocks, [
        { type: 'heading', text: 'Role Summary' },
        { type: 'paragraph', text: 'Build secure systems.' },
        { type: 'heading', text: 'Duties and Responsibilities:' },
        { type: 'ul', items: ['Develop APIs.', 'Review code.'] },
        { type: 'heading', text: 'Submission Guidelines' },
        { type: 'ol', items: ['Send your CV.', 'Include the vacancy number.'] },
    ]);
});

test('turns unmarked requirement lines into one semantic list', () => {
    const blocks = parseDescription('Job Requirements\nComputer Science degree.\nThree years of experience.');
    assert.deepEqual(blocks, [
        { type: 'heading', text: 'Job Requirements' },
        { type: 'ul', items: ['Computer Science degree.', 'Three years of experience.'] },
    ]);
});

test('supports Dari headings and full-width numbered lists', () => {
    const blocks = parseDescription('رهنمایی ثبت نام متقاضیان:\n۱. معلومات خویش را درج نمایید.\n２. اسناد را ارسال نمایید.');
    assert.deepEqual(blocks, [
        { type: 'heading', text: 'رهنمایی ثبت نام متقاضیان:' },
        { type: 'ol', items: ['معلومات خویش را درج نمایید.', 'اسناد را ارسال نمایید.'] },
    ]);
});

test('removes empty blocks and coalesces adjacent equivalent headings', () => {
    const blocks = parseDescription('\nSubmission Guidelines\n\nSubmission Guideline\nSend your CV.\n');
    assert.deepEqual(blocks, [
        { type: 'heading', text: 'Submission Guidelines' },
        { type: 'ul', items: ['Send your CV.'] },
    ]);
});

test('keeps source markup as inert text for React to escape', () => {
    const blocks = parseDescription('Role Summary\n<script>alert("x")</script>');
    assert.equal(blocks[1].text, '<script>alert("x")</script>');
});

test('repairs standalone bullet glyphs and wrapped source lines without losing text', () => {
    const blocks = parseDescription(`Development & Content Operations\n•\nBuild,\nmaintain, and troubleshoot ecommerce stores.\n•\nPerform updates.`);
    assert.deepEqual(blocks, [
        { type: 'heading', text: 'Development & Content Operations' },
        { type: 'ul', items: ['Build, maintain, and troubleshoot ecommerce stores.', 'Perform updates.'] },
    ]);
});

test('repairs a lowercase continuation in an unmarked application list', () => {
    const blocks = parseDescription('Submission Guidelines\nPlease send your CV and\nlinks to your live projects.');
    assert.deepEqual(blocks, [
        { type: 'heading', text: 'Submission Guidelines' },
        { type: 'ul', items: ['Please send your CV and links to your live projects.'] },
    ]);
});
