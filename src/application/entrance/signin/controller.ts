import { JSONWebToken, User, JWT, ClaimName } from '@digitalpersona/core';
import { CredInfo } from '../../../config/credInfo';
import { IScope } from 'angular';
import { ServiceError, IPolicyService, ResourceActions, ContextualInfo, PolicyInfo, Policy } from '@digitalpersona/services';
import { CardsReader, FingerprintReader, SampleFormat } from '@digitalpersona/devices';

export default class SigninController
{
    private identity: User|JSONWebToken;
    private busy: boolean = false;
    private selected: string;
    private policies: PolicyInfo | null;
    private credentials: CredInfo[];

    private fingerprintReader: FingerprintReader;
    private cardReader: CardsReader;

    static $inject = ["PolicyService", "$scope", "SupportedCredentials"]
    constructor(
        private policyService: IPolicyService,
        private $scope: IScope,
        private supportedCredentials: { all: CredInfo[]}
    ){
    }

    $onInit() {
        this.fingerprintReader = new FingerprintReader();
        this.fingerprintReader
            .startAcquisition(SampleFormat.Intermediate)
            .then(() => this.update())
            .catch(error => this.showError(error));

        this.cardReader = new CardsReader();
        this.cardReader.subscribe()
            .then(() => this.update())
            .catch(error => this.showError(error));

        this.updateCredentials();
        this.updateIdentity(User.Anonymous());
        this.busy = false;
    }

    $onDestroy() {
        this.fingerprintReader.stopAcquisition();
        this.fingerprintReader.off();
        delete this.fingerprintReader;

        this.cardReader.unsubscribe();
        this.cardReader.off();
        delete this.cardReader;
    }

    updateCredentials() {
        if (!this.policies)
            this.credentials = this.supportedCredentials.all;
        const allowed = this.getAllowedCredentials();
        this.credentials = this.supportedCredentials.all.filter(cred => allowed.includes(cred.id))
        if (!this.selected || !this.credentials.some(cred => cred.name === this.selected))
            this.selected = this.credentials[0].name;
    }

    getAllowedCredentials() {
        if (!this.policies)
            return this.supportedCredentials.all.map(cred => cred.id);
        const unique = (val: any, idx: number, arr: any[]) => arr.indexOf(val) === idx;
        return [].concat.apply([],
            this.policies.policyList
                .map(and => and.policy.map(or => or.cred_id)))
            .filter(unique);
    }

    isEnoughCredentials() {
        if (this.identity instanceof User)
            return false;
        const authenticated = JWT.claims(this.identity)[ClaimName.CredentialsUsed];
        if (!authenticated || authenticated.length === 0)
            return false;
        if (!this.policies)
            return true;        // any credential is enough
        const ids = authenticated.map(cred => cred.id);
        const satisfied = this.policies.policyList.some(rule =>
            rule.policy.every(el => ids.includes(el.cred_id.toUpperCase()))
        );
        return satisfied;
    }

    canIdentify() {
        return false;
//        return this.selected && this.selected.ident;
    }

    get isIdentified() {
        return !(this.identity instanceof User);
    }

    isSelected(name: string) {
        return this.selected && this.selected === name;
    }
    isAllowed(name: string) {
        return this.getAllowedCredentials().includes(name);
    }
    isAuthenticated(cred: CredInfo) {
        if (this.identity instanceof User)
            return false;
        const authenticated = JWT.claims(this.identity)[ClaimName.CredentialsUsed];
        return authenticated && authenticated.findIndex((used => used.id.toUpperCase() === cred.id)) >= 0;
    }

    updateUsername(value: string) {
        this.updateIdentity(new User(value));
    }

    show(selected: string) {
        console.log(`Showing '${selected}'`);
        this.selected = selected;// this.credentials[this.credentials.findIndex(c => c.name == selected)].name;
        console.log(this.selected);
    }

    getUser(): User {
        return (this.identity instanceof User)
            ? this.identity
            : new User(JWT.claims(this.identity)[ClaimName.WindowsAccountName] || "");
    }

    setBusy() {
        this.busy = true;
    }

    update() {
        this.$scope.$evalAsync(() =>{});
    }

    updateIdentity(identity: User| JSONWebToken) {
        if (this.identity == identity) return;
        this.identity = identity;
        this.busy = false;
        // TODO: get policy only if user name has changed
        this.policyService
            .GetPolicyInfo(this.getUser(), "*", ResourceActions.Write, new ContextualInfo())
            .then(policies => this.updatePolicies(policies));
        this.update();
    }

    updatePolicies(policies: PolicyInfo) {
        if (this.policies == policies) return;
        this.policies = policies;
        this.updateCredentials();
    }

    updateToken(token: JSONWebToken) {
        if (this.identity === token) return;
        if (this.isIdentified) {
            // TODO: if we've already identified the user,  make sure it is the same user again
        }
        this.updateIdentity(token);
        this.selectNext();
    }

    // selects next best credential among not entered yet
    selectNext() {
        if (this.identity instanceof User) return;
        if (!this.policies) return;
        const authenticated = JWT.claims(this.identity)[ClaimName.CredentialsUsed];
        if (!authenticated) return;
        const ids = authenticated.map(cred => cred.id);

        const score = (rule: Policy) => this.supportedCredentials.all
            .filter(cred => rule.policy.map(p => p.cred_id).includes(cred.id))
            .reduce((prev, curr) => prev * curr.strength, 1);

        const bestPolicyRules = this.policies.policyList
            .sort((a, b) => score(b) - score(a))
            .map(rule => rule.policy
                .map(cred => cred.cred_id)
                .filter(id => !ids.includes(id))) // create a reduced set of ids
            .filter(rule => rule.length > 0)
            .sort((a, b) => a.length - b.length);
        if (bestPolicyRules.length > 0) {
            const id = bestPolicyRules[0][0];
            const cred = this.supportedCredentials.all.find(cred => cred.id === id);
            if (cred)
                this.show(cred.name);
        }
    }

    showError(error: ServiceError|Error) {
        this.busy = false;
        if (error instanceof ServiceError) {
            if (error.code == -2146893033) {  // Authentication context expired, drop the token and replace with a user
                this.updateIdentity(this.getUser());
            }
        }
        this.update();
    }
}