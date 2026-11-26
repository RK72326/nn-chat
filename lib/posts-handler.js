'use strict';
const pug = require('pug');
const Cookies = require('cookies');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({ log: [ 'query' ] });
const util = require('./handler-util');
const { currentThemeKey } = require('../config');

const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const relativeTime = require('dayjs/plugin/relativeTime');
require('dayjs/locale/ja');
dayjs.locale('ja');
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(relativeTime);
dayjs.tz.setDefault('Asia/Tokyo');
const crypto = require('node:crypto');

const oneTimeTokenMap = new Map();
const MAX_CONTENT_LENGTH = 200;

const DAILY_TOPICS = [
  '最近食べておいしかったものは？',
  'もし1つだけ魔法が使えるなら何する？',
  '休日のいちばん好きな過ごし方は？',
  'ちょっと笑えた最近の小さな出来事',
  '無人島に1つだけ持っていくなら？'
];

const TOPICS = [
  '雑談',
  ...DAILY_TOPICS
];

const TOPIC_TONE_COUNT = 6;

function getTopicToneIndex(topic) {
  const indexInTopics = TOPICS.indexOf(topic);
  if (indexInTopics >= 0) {
    return indexInTopics % TOPIC_TONE_COUNT;
  }
  let hash = 0;
  for (const ch of String(topic || '')) {
    hash = (hash + ch.charCodeAt(0)) % TOPIC_TONE_COUNT;
  }
  return hash;
}

function getTodayTopicIndex() {
  const now = dayjs().tz('Asia/Tokyo');
  const startOfYear = now.startOf('year');
  const dayOfYear = now.diff(startOfYear, 'day') + 1;
  const daySeed = now.year() * 1000 + dayOfYear;
  const dailyTopic = DAILY_TOPICS[daySeed % DAILY_TOPICS.length];
  const indexInTopics = TOPICS.indexOf(dailyTopic);
  return indexInTopics >= 0 ? indexInTopics : 0;
}

function resolveTopicIndex(rawIndex) {
  const parsed = Number.parseInt(rawIndex, 10);
  if (Number.isInteger(parsed) && parsed >= 0 && parsed < TOPICS.length) {
    return parsed;
  }
  return getTodayTopicIndex();
}

function formatPostWithTopic(topic, content) {
  return `[${topic}] ${content}`;
}

function parsePostContent(rawContent) {
  const match = /^\[([^\]]+)\]\s*([\s\S]*)$/.exec(rawContent || '');
  if (match) {
    return {
      topic: match[1],
      body: match[2]
    };
  }
  return {
    topic: '雑談',
    body: rawContent || ''
  };
}

async function handle(req, res) {
  const cookies = new Cookies(req, res);
  const currentTheme = cookies.get(currentThemeKey) || 'light';
  const options = { maxAge: 30 * 86400 * 1000 };
  cookies.set(currentThemeKey, currentTheme, options);

  const urlObj = new URL(req.url, 'http://localhost');
  const selectedTopicIndex = resolveTopicIndex(urlObj.searchParams.get('topic'));
  const selectedTopic = TOPICS[selectedTopicIndex];
  const onlyCurrentTopic = urlObj.searchParams.get('onlyCurrent') === '1';
  const errorType = urlObj.searchParams.get('error');

  let errorMessage = '';
  if (errorType === 'empty') {
    errorMessage = '空のメッセージは投稿できません。何かひとこと書いてね！';
  } else if (errorType === 'too_long') {
    errorMessage = `文字数オーバーです（${MAX_CONTENT_LENGTH}文字以内で入力してください）。`;
  }

  switch (req.method) {
    case 'GET': {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8'
      });

      const findOptions = {
        orderBy: {
          id: 'asc'
        }
      };
      if (onlyCurrentTopic) {
        findOptions.where = {
          content: {
            startsWith: `[${selectedTopic}]`
          }
        };
      }

      const rawPosts = await prisma.post.findMany(findOptions);
      const posts = rawPosts.map((post) => {
        const parsed = parsePostContent(post.content);
        return {
          ...post,
          topic: parsed.topic,
          topicTone: getTopicToneIndex(parsed.topic),
          content: parsed.body,
          relativeCreatedAt: dayjs(post.createdAt).tz().fromNow(),
          absoluteCreatedAt: dayjs(post.createdAt).tz().format('YYYY年MM月DD日 HH時mm分ss秒')
        }
      });

      const oneTimeToken = crypto.randomBytes(8).toString('hex');
      oneTimeTokenMap.set(req.user, oneTimeToken);
      const todayTopicIndex = getTodayTopicIndex();
      const todayTopic = TOPICS[todayTopicIndex];

      res.end(pug.renderFile('./views/posts.pug', {
        currentTheme,
        posts,
        user: req.user,
        oneTimeToken,
        topics: TOPICS,
        todayTopic,
        todayTopicIndex,
        selectedTopicIndex,
        selectedTopic,
        onlyCurrentTopic,
        errorMessage,
        maxLength: MAX_CONTENT_LENGTH
      }));

      console.info(
        `閲覧されました: user: ${req.user}, ` +
        `remoteAddress: ${req.socket.remoteAddress}, ` +
        `userAgent: ${req.headers['user-agent']} `
      );
      break;
    }
    case 'POST': {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      }).on('end', async () => {
        const params = new URLSearchParams(body);
        const rawContent = params.get('content') || '';
        const trimmedContent = rawContent.trim();
        const topicIndex = resolveTopicIndex(params.get('topicIndex'));
        const activeTopic = TOPICS[topicIndex];
        const onlyCurrent = params.get('onlyCurrent') === '1' ? '1' : '0';
        const requestedOneTimeToken = params.get('oneTimeToken');

        if (!requestedOneTimeToken || oneTimeTokenMap.get(req.user) !== requestedOneTimeToken) {
          util.handleBadRequest(req, res);
          return;
        }

        if (!trimmedContent) {
          oneTimeTokenMap.delete(req.user);
          res.writeHead(303, {
            'Location': `/posts?topic=${topicIndex}&onlyCurrent=${onlyCurrent}&error=empty`
          });
          res.end();
          return;
        }

        if (trimmedContent.length > MAX_CONTENT_LENGTH) {
          oneTimeTokenMap.delete(req.user);
          res.writeHead(303, {
            'Location': `/posts?topic=${topicIndex}&onlyCurrent=${onlyCurrent}&error=too_long`
          });
          res.end();
          return;
        }

        const formattedContent = formatPostWithTopic(activeTopic, trimmedContent);
        console.info(`送信されました: ${formattedContent}`);

        await prisma.post.create({
          data: {
            content: formattedContent,
            postedBy: req.user
          }
        });
        oneTimeTokenMap.delete(req.user);
        res.writeHead(303, {
          'Location': `/posts?topic=${topicIndex}&onlyCurrent=${onlyCurrent}`
        });
        res.end();
      });
      break;
    }
    default:
      util.handleBadRequest(req, res);
      break;
  }
}

function handleDelete(req, res) {
  switch (req.method) {
    case 'POST': {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      }).on('end', async () => {
        const params = new URLSearchParams(body);
        const id = parseInt(params.get('id'), 10);
        const topicIndex = resolveTopicIndex(params.get('topicIndex'));
        const onlyCurrent = params.get('onlyCurrent') === '1' ? '1' : '0';
        const requestedOneTimeToken = params.get('oneTimeToken');
        if (!id || !requestedOneTimeToken || oneTimeTokenMap.get(req.user) !== requestedOneTimeToken) {
          util.handleBadRequest(req, res);
          return;
        }
        const post = await prisma.post.findUnique({
          where: { id }
        });
        if (!post) {
          util.handleBadRequest(req, res);
          return;
        }
        if (req.user !== post.postedBy && req.user !== 'admin') {
          util.handleBadRequest(req, res);
          return;
        }
        await prisma.post.delete({
          where: { id }
        });
        console.info(
          `削除されました: user: ${req.user}, ` +
            `remoteAddress: ${req.socket.remoteAddress}, ` +
            `userAgent: ${req.headers['user-agent']} `
        );
        oneTimeTokenMap.delete(req.user);
        res.writeHead(303, {
          'Location': `/posts?topic=${topicIndex}&onlyCurrent=${onlyCurrent}`
        });
        res.end();
      });
      break;
    }
    default:
      util.handleBadRequest(req, res);
      break;
  }
}

function handleRedirectPosts(req, res) {
  res.writeHead(303, {
    'Location': '/posts'
  });
  res.end();
}

module.exports = {
  handle,
  handleDelete,
};