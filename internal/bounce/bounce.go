package bounce

import (
	"crypto/tls"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/emersion/go-imap"
	"github.com/emersion/go-imap/client"
	"github.com/emersion/go-message/mail"
	"github.com/jmoiron/sqlx"
	"github.com/lib/pq"
)

// https://github.com/phpList/phplist3/blob/35af3b8101a216e87873220be9432ee35a80a1eb/public_html/lists/admin/processbounces.php#L186

const (
	// idHeader is the identifying subscriber ID header to look for in
	// bounced e-mails.
	idHeader = "X-Pm-Internal-Id"
)

// Mailbox represents a bounce mailbox configuration.
type MailboxOpt struct {
	// Host is the server's hostname.
	Host string `json:"host"`

	// Port is the server port.
	Port int `json:"port"`

	// Username is the mail server login username.
	Username string `json:"username"`

	// Password is the mail server login password.
	Password string `json:"password"`

	// Folder is the name of the IMAP folder to scan for e-mails.
	Folder string `json:"folder"`

	// Optional TLS settings.
	TLSEnabled    bool `json:"tls_enabled"`
	TLSSkipVerify bool `json:"tls_skip_verify"`
}

// Opt represents bounce processing options.
type Opt struct {
	BounceCount    int        `json:"count"`
	BounceAction   string     `json:"action"`
	Mailbox        MailboxOpt `json:"mailbox"`
	EnableWebhooks bool       `json:"enable_webooks"`
}

// Manager handles e-mail bounces.
type Manager struct {
	queue   chan Bounce
	client  *client.Client
	queries *Queries
	opt     Opt
	log     *log.Logger
}

// Queries contains the queries.
type Queries struct {
	DB *sqlx.DB

	RecordBounce        *sqlx.Stmt
	BlocklistSubscriber *sqlx.Stmt
	DeleteSubscriber    *sqlx.Stmt
}

// Bounce represents a single bounce event.
type Bounce struct {
	Type         string          `json:"type"`
	CampaignUUID string          `json:"campaign_uuid"`
	Source       string          `json:"source"`
	Meta         json.RawMessage `json:"meta"`
	CreatedAt    time.Time       `json:"created_at"`

	// One of these should be provided.
	Email          string `json:"email"`
	SubscriberUUID string `json:"subscriber_uuid"`
}

// New returns a new instance of the bounce manager.
func New(opt Opt, q *Queries, lo *log.Logger) (*Manager, error) {
	m := &Manager{
		opt:     opt,
		queries: q,
		queue:   make(chan Bounce, 1000),
		log:     lo,
	}

	return m, nil
}

// Run is a blocking function that starts listening for bounce events from
// webhooks and or mailboxes.
func (m *Manager) Run() {
	for {
		select {
		case b, ok := <-m.queue:
			if !ok {
				return
			}

			_, err := m.queries.RecordBounce.Exec(b.SubscriberUUID,
				b.Email,
				b.CampaignUUID,
				b.Type,
				b.Source,
				b.Meta,
				b.CreatedAt,
				m.opt.BounceCount,
				m.opt.BounceAction)
			if err != nil {
				// Ignore the error if it complained of no subscriber.
				if pqErr, ok := err.(*pq.Error); ok && pqErr.Column == "subscriber_id" {
					m.log.Printf("bounced subscriber (%s / %s) not found", b.SubscriberUUID, b.Email)
					continue
				}
				m.log.Printf("error recording bounce: %v", err)
			}
		}
	}
}

// Record records a new bounce event given the subscriber's email or UUID.
func (m *Manager) Record(b Bounce) error {
	select {
	case m.queue <- b:
	}
	return nil
}

func (m *Manager) Scan() error {
	var (
		c   *client.Client
		err error

		addr = fmt.Sprintf("%s:%d", m.opt.Mailbox.Host, m.opt.Mailbox.Port)
	)

	if m.opt.Mailbox.TLSEnabled {
		// TLS connection.
		var tlsCfg *tls.Config
		tlsCfg = &tls.Config{}
		if m.opt.Mailbox.TLSSkipVerify {
			tlsCfg.InsecureSkipVerify = m.opt.Mailbox.TLSSkipVerify
		} else {
			tlsCfg.ServerName = m.opt.Mailbox.Host
		}

		c, err = client.DialTLS(addr, tlsCfg)
	} else {
		// Non-TLS connection.
		c, err = client.Dial(addr)
	}

	if err != nil {
		return err
	}
	m.client = c

	// Login?
	if m.opt.Mailbox.Username != "" {
		if err := m.client.Login(m.opt.Mailbox.Username, m.opt.Mailbox.Password); err != nil {
			return err
		}
	}

	// List mailboxes
	// mailboxes := make(chan *imap.MailboxInfo, 10)
	// done := make(chan error, 1)
	// go func() {
	// 	done <- c.List("", "*", mailboxes)
	// }()

	// log.Println("Mailboxes:")
	// for m := range mailboxes {
	// 	log.Println("* " + m.Name)
	// }

	// Select the mailbox to scan.
	mbox, err := c.Select(m.opt.Mailbox.Folder, false)
	if err != nil {
		log.Fatal(err)
	}
	log.Println("Flags:", mbox.Flags)

	// Get the last 4 messages
	fmt.Println("total=", mbox.Messages)
	seqset := new(imap.SeqSet)
	seqset.AddRange(mbox.Messages, mbox.Messages)

	messages := make(chan *imap.Message, 10)
	done := make(chan error, 1)
	go func() {
		done <- c.Fetch(seqset, []imap.FetchItem{imap.FetchEnvelope}, messages)
	}()

	log.Println("Last 4 messages:")
	for msg := range messages {
		log.Println("* "+msg.Envelope.Subject, msg.Envelope.Date)

	}

	var section imap.BodySectionName
	section.Specifier = imap.HeaderSpecifier

	items := []imap.FetchItem{section.FetchItem()}

	messages = make(chan *imap.Message, 1)
	if err := c.Fetch(seqset, items, messages); err != nil {
		return err
	}

	msg := <-messages
	if msg == nil {
		log.Fatal("Server didn't returned message")
	}

	r := msg.GetBody(&section)
	if r == nil {
		log.Fatal("Server didn't returned message body")
	}

	// Create a new mail reader
	mr, err := mail.CreateReader(r)
	if err != nil {
		log.Fatal(err)
	}

	fmt.Println("ID = ", mr.Header.Get(idHeader))
	return nil
}
