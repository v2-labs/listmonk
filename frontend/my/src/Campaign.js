import React from "react"
import { Modal, Tabs, Row, Col, Form, Switch, Select, Radio, Tag, Input, Button, Icon, Spin, DatePicker, Popconfirm, notification } from "antd"
import * as cs from "./constants"
import Media from "./Media"
import ModalPreview from "./ModalPreview"

import moment from 'moment'
import ReactQuill from "react-quill"
import Delta from "quill-delta"
import "react-quill/dist/quill.snow.css"

const formItemLayout = {
    labelCol: { xs: { span: 16 }, sm: { span: 4 } },
    wrapperCol: { xs: { span: 16 }, sm: { span: 10 } }
}

const formItemTailLayout = {
    wrapperCol: { xs: { span: 24, offset: 0 }, sm: { span: 10, offset: 4 } }
}

class Editor extends React.PureComponent {
    state = {
        editor: null,
        quill: null,
        rawInput: null,
        selContentType: "richtext",
        contentType: "richtext",
        body: ""
    }

    quillModules = {
        toolbar: {
            container: [
                [{"header": [1, 2, 3, false] }],
                ["bold", "italic", "underline", "strike", "blockquote", "code"],
                [{ "color": [] }, { "background": [] }, { 'size': [] }],
                [{"list": "ordered"}, {"list": "bullet"}, {"indent": "-1"}, {"indent": "+1"}],
                [{"align": ""}, { "align": "center" }, { "align": "right" }, { "align": "justify" }],
                ["link", "gallery"],
                ["clean", "font"]
            ],
            handlers: {
                "gallery": () => {
                    this.props.toggleMedia()
                }
            }
        }
    }

    componentDidMount = () => {
        // The editor component will only load once the individual campaign metadata
        // has loaded, i.e., record.body is guaranteed to be available here.
        if(this.props.record && this.props.record.id) {
            this.setState({
                body: this.props.record.body,
                contentType: this.props.record.content_type,
                selContentType: this.props.record.content_type
            })
        }
    }

    // Custom handler for inserting images from the media popup.
    insertMedia = (uri) => {
        const quill = this.state.quill.getEditor()

        let range = quill.getSelection(true);
        quill.updateContents(new Delta()
          .retain(range.index)
          .delete(range.length)
          .insert({ image: uri })
        , null);
    }

    handleSelContentType = (_, e) => {
        this.setState({ selContentType: e.props.value })
    }

    handleSwitchContentType = () => {
        this.setState({ contentType: this.state.selContentType })
        if(!this.state.quill || !this.state.quill.editor || !this.state.rawInput) {
            return
        }

        // Switching from richtext to html.
        let body = ""
        if(this.state.selContentType === "html") {
            body = this.state.quill.editor.container.firstChild.innerHTML
            this.state.rawInput.value = body
        } else if(this.state.selContentType === "richtext") {
            body = this.state.rawInput.value
            this.state.quill.editor.clipboard.dangerouslyPasteHTML(body, "raw")
        }

        this.props.setContent(this.state.selContentType, body)
    }

    render() {
        return (
            <div>
                <header className="header">
                    { !this.props.formDisabled &&
                        <Row>
                            <Col span={ 20 }>
                                <div className="content-type">
                                    <p>Content format</p>
                                    <Select name="content_type" onChange={ this.handleSelContentType } style={{ minWidth: 200 }}
                                        value={ this.state.selContentType }>
                                        <Select.Option value="richtext">Rich Text</Select.Option>
                                        <Select.Option value="html">Raw HTML</Select.Option>
                                    </Select>
                                    { this.state.contentType !== this.state.selContentType &&
                                    <div className="actions">
                                        <Popconfirm title="The content may lose its formatting. Are you sure?"
                                            onConfirm={ this.handleSwitchContentType }>
                                            <Button>
                                                <Icon type="save" /> Switch format
                                            </Button>
                                        </Popconfirm>
                                    </div>}
                                </div>
                            </Col>
                            <Col span={ 4 }></Col>
                        </Row>
                    }
                </header>
                <ReactQuill
                    readOnly={ this.props.formDisabled }
                    style={{ display: this.state.contentType === "richtext" ? "block" : "none" }}
                    modules={ this.quillModules }
                    defaultValue={ this.props.record.body }
                    ref={ (o) => {
                        if(o) {
                            this.setState({ quill: o })
                        }
                    }}
                    onChange={ () => {
                        if(!this.state.quill) {
                            return
                        }
                        
                        this.props.setContent(this.state.contentType, this.state.quill.editor.root.innerHTML)
                    } }
                />

                <Input.TextArea
                    readOnly={ this.props.formDisabled }
                    placeholder="Your message here"
                    style={{ display: this.state.contentType === "html" ? "block" : "none" }}
                    id="html-body"
                    rows={ 10 }
                    autosize={ { minRows: 2, maxRows: 10 } }
                    defaultValue={ this.props.record.body }
                    ref={ (o) => {
                        if(!o) {
                            return
                        }
                        
                        this.setState({ rawInput: o.textAreaRef })
                    }}
                    onChange={ (e) => {
                        this.props.setContent(this.state.contentType, e.target.value)
                    }}
                />
            </div>
        )
    }
}

class TheFormDef extends React.PureComponent {
    state = {
        editorVisible: false,
        sendLater: false,
        loading: false
    }

    componentWillReceiveProps(nextProps) {
        const has = nextProps.isSingle && nextProps.record.send_at !== null
        if(!has) {
            return
        }

        if(this.state.sendLater !== has) {
            this.setState({ sendLater: has })
        }
    }

    validateEmail = (rule, value, callback) => {
        if(!value.match(/(.+?)\s<(.+?)@(.+?)>/)) {
            return callback("Format should be: Your Name <email@address.com>")
        }

        callback()
    }

    handleSendLater = (e) => {
        this.setState({ sendLater: e })
    }

    // Handle create / edit form submission.
    handleSubmit = (e) => {
        e.preventDefault()
        this.props.form.validateFields((err, values) => {
            if (err) {
                return
            }
            
            if(!values.tags) {
                values.tags = []
            }
            
            values.body = this.props.body
            values.content_type = this.props.contentType
            
            // Create a new campaign.
            this.setState({ loading: true })
            if(!this.props.isSingle) {
                this.props.modelRequest(cs.ModelCampaigns, cs.Routes.CreateCampaign, cs.MethodPost, values).then((resp) => {
                    notification["success"]({ placement: "topRight",
                        message: "Campaign created",
                        description: `"${values["name"]}" created` })

                    this.props.route.history.push(cs.Routes.ViewCampaign.replace(":id", resp.data.data.id))
                    this.props.fetchRecord(resp.data.data.id)
                    this.props.setCurrentTab("content")
                    this.setState({ loading: false })
                }).catch(e => {
                    notification["error"]({ message: "Error", description: e.message })
                })
            } else {
                this.props.modelRequest(cs.ModelCampaigns, cs.Routes.UpdateCampaign, cs.MethodPut, { ...values, id: this.props.record.id }).then((resp) => {
                    notification["success"]({ placement: "topRight",
                    message: "Campaign updated",
                    description: `"${values["name"]}" updated` })
                }).catch(e => {
                    notification["error"]({ message: "Error", description: e.message })
                    this.setState({ loading: false })
                })
            }
        })
    }


    handleTestCampaign = (e) => {
        e.preventDefault()
        this.props.form.validateFields((err, values) => {
            if (err) {
                return
            }

            if(!values.tags) {
                values.tags = []
            }

            values.id = this.props.record.id
            values.body = this.props.body
            values.content_type = this.props.contentType

            this.setState({ loading: true })
            this.props.request(cs.Routes.TestCampaign, cs.MethodPost, values).then((resp) => {
                this.setState({ loading: false })
                notification["success"]({ placement: "topRight",
                message: "Test sent",
                description: `Test messages sent` })
            }).catch(e => {
                this.setState({ loading: false })
                notification["error"]({ message: "Error", description: e.message })
            })
        })
    }

    render() {
        const { record } = this.props;
        const { getFieldDecorator } = this.props.form
  
        let subLists = []
        if(this.props.isSingle && record.lists) {
            subLists = record.lists.map((v) => { return v.id !== 0 ? v.id : null }).filter(v => v !== null)
        }

        return (
            <div>
                <Spin spinning={ this.state.loading }>
                    <Form onSubmit={ this.handleSubmit }>
                        <Form.Item {...formItemLayout} label="Campaign name">
                            {getFieldDecorator("name", {
                                extra: "This is internal and will not be visible to subscribers",
                                initialValue: record.name,
                                rules: [{ required: true }]
                            })(<Input disabled={ this.props.formDisabled }autoFocus maxLength="200" />)}
                        </Form.Item>
                        <Form.Item {...formItemLayout} label="Subject">
                            {getFieldDecorator("subject", {
                                initialValue: record.subject,
                                rules: [{ required: true }]
                            })(<Input disabled={ this.props.formDisabled } maxLength="500" />)}
                        </Form.Item>
                        <Form.Item {...formItemLayout} label="From address">
                            {getFieldDecorator("from_email", {
                                initialValue: record.from_email,
                                rules: [{ required: true }, { validator: this.validateEmail }]
                            })(<Input disabled={ this.props.formDisabled } placeholder="Company Name <email@company.com>" maxLength="200" />)}
                        </Form.Item>
                        <Form.Item {...formItemLayout} label="Lists" extra="Lists to subscribe to">
                            {getFieldDecorator("lists", { initialValue: subLists, rules: [{ required: true }] })(
                                <Select disabled={ this.props.formDisabled } mode="multiple">
                                    {[...this.props.data[cs.ModelLists]].map((v, i) =>
                                        <Select.Option value={ v["id"] } key={ v["id"] }>{ v["name"] }</Select.Option>
                                    )}
                                </Select>
                            )}
                        </Form.Item>
                        <Form.Item {...formItemLayout} label="Template" extra="Template">
                            {getFieldDecorator("template_id", { initialValue: record.template_id, rules: [{ required: true }] })(
                                <Select disabled={ this.props.formDisabled }>
                                    {[...this.props.data[cs.ModelTemplates]].map((v, i) =>
                                        <Select.Option value={ v["id"] } key={ v["id"] }>{ v["name"] }</Select.Option>
                                    )}
                                </Select>
                            )}
                        </Form.Item>
                        <Form.Item {...formItemLayout} label="Tags" extra="Hit Enter after typing a word to add multiple tags">
                            {getFieldDecorator("tags", { initialValue: record.tags })(
                                <Select disabled={ this.props.formDisabled } mode="tags"></Select>
                                )}
                        </Form.Item>
                        <Form.Item {...formItemLayout} label="Messenger">
                            {getFieldDecorator("messenger", { initialValue: record.messenger ? record.messenger : "email" })(
                                <Radio.Group className="messengers">
                                    {[...this.props.messengers].map((v, i) =>
                                        <Radio disabled={ this.props.formDisabled } value={v} key={v}>{ v }</Radio>
                                    )}
                                </Radio.Group>
                            )}
                        </Form.Item>

                        <hr />
                        <Form.Item {...formItemLayout} label="Send later?">
                            <Row>
                                <Col span={ 2 }>
                                    {getFieldDecorator("send_later", { defaultChecked: this.props.isSingle })(
                                        <Switch disabled={ this.props.formDisabled }
                                                checked={ this.state.sendLater }
                                                onChange={ this.handleSendLater } />
                                    )}
                                </Col>
                                <Col span={ 12 }>
                                    {this.state.sendLater && getFieldDecorator("send_at", 
                                        { initialValue: (record && typeof(record.send_at) === "string") ? moment(record.send_at) : moment(new Date()).add(1, "days").startOf("day") })(
                                        <DatePicker
                                            disabled={ this.props.formDisabled }
                                            showTime
                                            format="YYYY-MM-DD HH:mm:ss"
                                            placeholder="Select a date and time"
                                        />
                                    )}
                                </Col>
                            </Row>
                        </Form.Item>

                        { !this.props.formDisabled && 
                            <Form.Item {...formItemTailLayout}>
                                <Button htmlType="submit" type="primary">
                                    <Icon type="save" /> { !this.props.isSingle ? "Continue" : "Save changes" }
                                </Button>
                            </Form.Item>
                        }

                        { this.props.isSingle &&
                            <div>
                                <hr />
                                <Form.Item {...formItemLayout} label="Send test messages" extra="Hit Enter after typing an address to add multiple recipients. The addresses must belong to existing subscribers.">
                                    {getFieldDecorator("subscribers")(
                                        <Select mode="tags" style={{ width: "100%" }}></Select>
                                    )}
                                </Form.Item>
                                <Form.Item {...formItemLayout} label="&nbsp;" colon={ false }>
                                    <Button onClick={ this.handleTestCampaign }><Icon type="mail" /> Send test</Button>
                                </Form.Item>
                            </div>
                        }
                    </Form>
                </Spin>
            </div>

        )
    }
}
const TheForm = Form.create()(TheFormDef)


class Campaign extends React.PureComponent {
    state = {
        campaignID: this.props.route.match.params ? parseInt(this.props.route.match.params.campaignID, 10) : 0,
        record: {},
        contentType: "richtext",
        messengers: [],
        previewRecord: null,
        body: "",
        currentTab: "form",
        editor: null,
        loading: true,
        mediaVisible: false,
        formDisabled: false
    }
    
    componentDidMount = () => {
        // Fetch lists.
        this.props.modelRequest(cs.ModelLists, cs.Routes.GetLists, cs.MethodGet)
        
        // Fetch templates.
        this.props.modelRequest(cs.ModelTemplates, cs.Routes.GetTemplates, cs.MethodGet)

        // Fetch messengers.
        this.props.request(cs.Routes.GetCampaignMessengers, cs.MethodGet).then((r) => {
            this.setState({ messengers: r.data.data, loading: false })
        })

        // Fetch campaign.
        if(this.state.campaignID) {
            this.fetchRecord(this.state.campaignID)
        }
    }

    fetchRecord = (id) => {
        this.props.request(cs.Routes.GetCampaign, cs.MethodGet, { id: id }).then((r) => {
            const record = r.data.data
            this.setState({ record: record, loading: false })

            // The form for non draft and scheduled campaigns should be locked.
            if(record.status !== cs.CampaignStatusDraft &&
            record.status !== cs.CampaignStatusScheduled) {
                this.setState({ formDisabled: true })
            }
        }).catch(e => {
            notification["error"]({ message: "Error", description: e.message })
        })
    }

    setContent = (contentType, body) => {
        this.setState({ contentType: contentType, body: body })
    }
    
    toggleMedia = () => {
        this.setState({ mediaVisible: !this.state.mediaVisible })
    }
    
    setCurrentTab = (tab) => {
        this.setState({ currentTab: tab })
    }

    handlePreview = (record) => {
        this.setState({ previewRecord: record })
    }

    render() {
        return (
            <section className="content campaign">
                <Row>
                    <Col span={22}>
                        { !this.state.record.id && <h1>Create a campaign</h1> }
                        { this.state.record.id &&
                            <h1>
                                <Tag color={ cs.CampaignStatusColors[this.state.record.status] }>{ this.state.record.status }</Tag>
                                { this.state.record.name }
                            </h1>
                        }
                    </Col>
                    <Col span={2}>
                    </Col>
                </Row>
                <br />

                <Tabs type="card"
                    activeKey={ this.state.currentTab }
                    onTabClick={ (t) => {
                        this.setState({ currentTab: t })
                    }}>
                    <Tabs.TabPane tab="Campaign" key="form">
                        <Spin spinning={ this.state.loading }>
                            <TheForm { ...this.props }
                                record={ this.state.record }
                                isSingle={ this.state.record.id ? true : false }
                                messengers={ this.state.messengers }
                                body={ this.state.body ? this.state.body : this.state.record.body }
                                contentType={ this.state.contentType }
                                formDisabled={ this.state.formDisabled }
                                fetchRecord={ this.fetchRecord }
                                setCurrentTab={ this.setCurrentTab }
                            />
                        </Spin>
                    </Tabs.TabPane>
                    <Tabs.TabPane tab="Content" disabled={ this.state.record.id ? false : true } key="content">
                        <Editor { ...this.props }
                            ref={ (e) => {
                                // Take the editor's reference and save it in the state
                                // so that it's insertMedia() function can be passed to <Media />
                                this.setState({ editor: e })
                            }}
                            isSingle={ this.state.record.id ? true : false }
                            record={ this.state.record }
                            visible={ this.state.editorVisible }
                            toggleMedia={ this.toggleMedia }
                            setContent={ this.setContent }
                            formDisabled={ this.state.formDisabled }
                        />
                        <div className="content-actions">
                            <p><Button icon="search"  onClick={() => this.handlePreview(this.state.record)}>Preview</Button></p>
                        </div>
                    </Tabs.TabPane>
                </Tabs>

                <Modal visible={ this.state.mediaVisible } width="900px"
                        title="Media"
                        okText={ "Ok" }
                        onCancel={ this.toggleMedia }
                        onOk={ this.toggleMedia }>  
                    <Media { ...{ ...this.props,
                            insertMedia: this.state.editor ? this.state.editor.insertMedia : null,
                            onCancel: this.toggleMedia,
                            onOk: this.toggleMedia }} />
                </Modal>

                { this.state.previewRecord &&
                    <ModalPreview
                        title={ this.state.previewRecord.name }
                        body={ this.state.body }
                        previewURL={ cs.Routes.PreviewCampaign.replace(":id", this.state.previewRecord.id) }
                        onCancel={() => {
                            this.setState({ previewRecord: null })
                        }}
                    />
                }
            </section>
        )
    }
}

export default Campaign