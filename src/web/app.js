const path = require('path');
const express = require('express');
const basicAuth = require('express-basic-auth');

const { config } = require('../db');

const timingsRouter = require('./routes/timings');
const statusRouter = require('./routes/status');
const tagsRouter = require('./routes/tags');
const databaseRouter = require('./routes/database');
const eventsRouter = require('./routes/events');
const unassignedRouter = require('./routes/unassigned');

const app = express();

app.use(express.json());

const auth = basicAuth({
  users: { [config.web.username]: config.web.password },
  challenge: true
});

const protectedPrefixes = ['/setup.html', '/admin', '/api/tags', '/api/db', '/api/events'];
const publicPaths = ['/api/events/active'];

app.use((req, res, next) => {
  if (publicPaths.includes(req.path)) {
    return next();
  }
  if (
    protectedPrefixes.some(p => req.path === p || req.path.startsWith(p + '/'))
  ) {
    return auth(req, res, next);
  }
  if (req.path === '/api/unassigned') {
    return auth(req, res, next);
  }
  next();
});

app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

app.use('/css', express.static(path.join(__dirname, '..', '..', 'css')));
app.use(express.static(path.join(__dirname, '..', '..', 'html')));

app.use('/api/timings', timingsRouter);
app.use('/api/status', statusRouter);
app.use('/api/tags', tagsRouter);
app.use('/api/db', databaseRouter);
app.use('/api/events', eventsRouter);
app.use('/api/unassigned', unassignedRouter);

app.get('/', (req, res) => {
  res.redirect('/live');
});

app.get('/live', (req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'html', 'timing.html'));
});

app.get('/classifiche', (req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'html', 'classifiche.html'));
});

app.get('/admin', auth, (req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'html', 'admin.html'));
});

app.get('/allenamento/:code/manage', auth, (req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'html', 'training-manage.html'));
});

app.get('/allenamento/:code', auth, (req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'html', 'training.html'));
});

app.get('/gara/:code/manage', auth, (req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'html', 'race-manage.html'));
});

app.get('/gara/:code', (req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'html', 'race-view.html'));
});

module.exports = app;
